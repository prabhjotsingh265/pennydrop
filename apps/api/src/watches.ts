import { GONE_FOR_GOOD_STREAK, Prisma, syncTarget, type Db } from '@pennydrop/db';
import {
  addWatchSchema,
  bulkAddSchema,
  pickSchema,
  updateWatchSchema,
  type BulkResult,
  type CheckSummary,
  type WatchDetail,
  type WatchStatus,
  type WatchSummary,
} from '@pennydrop/domain';
import { cleanUrl } from '@pennydrop/fetch';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { LiveMessage } from '@pennydrop/queue';
import type { Previews } from './previews.ts';
import { vetAddress, type VetDeps } from './sites.ts';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 30;
/** "Check now" waits this long after the last check. */
const CHECK_NOW_COOLDOWN_MS = 60_000;
/** Real shops are checked hourly at most; every 15 minutes is for the practice shops. */
const SHORTEST_REAL_INTERVAL = 3_600;

export interface WatchDeps extends VetDeps {
  /** Asks the dispatcher to run now rather than at its next tick. */
  wake: () => Promise<void>;
  previews: Previews;
  /** Tells every open dashboard of this workspace that its watchlist changed. */
  publish: (message: LiveMessage) => Promise<void>;
  now?: () => number;
}

const include = {
  target: { include: { site: { select: { host: true, demoAllowed: true } } } },
} satisfies Prisma.WatchInclude;
type WatchRow = Prisma.WatchGetPayload<{ include: typeof include }>;

const minor = (value: bigint | null) => (value === null ? null : Number(value));
const iso = (value: Date | null) => value?.toISOString() ?? null;

/** "/p/stoneware-mug" reads as "Stoneware mug" until the product has a label. */
export function labelFromUrl(url: string): string {
  const { hostname, pathname } = new URL(url);
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  let words: string;
  try {
    words = decodeURIComponent(last);
  } catch {
    words = last;
  }
  words = words
    .replace(/\.[a-z]{2,5}$/i, '')
    .replace(/[-_+]+/g, ' ')
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : hostname;
}

/** Watches as the dashboard shows them, with history since `since` (or all of it). */
async function summarise(db: Db, rows: WatchRow[], since: Date | null): Promise<WatchSummary[]> {
  const points = rows.length
    ? await db.pricePoint.findMany({
        where: {
          targetId: { in: [...new Set(rows.map((row) => row.targetId))] },
          ...(since ? { lastSeenAt: { gte: since } } : {}),
        },
        orderBy: { firstSeenAt: 'asc' },
        select: { targetId: true, firstSeenAt: true, price: true, inStock: true },
      })
    : [];
  const history = new Map<string, WatchSummary['history']>();
  for (const point of points) {
    // A price that began before the window still held at its start.
    const t = since && point.firstSeenAt < since ? since : point.firstSeenAt;
    const list = history.get(point.targetId) ?? [];
    list.push({ t: t.toISOString(), price: minor(point.price), inStock: point.inStock });
    history.set(point.targetId, list);
  }

  return rows.map(({ target, ...watch }) => ({
    id: watch.id,
    targetId: target.id,
    label: watch.label ?? target.title ?? labelFromUrl(target.url),
    url: target.url,
    host: target.site.host,
    currency: target.currency,
    price: minor(target.currentPrice),
    targetPrice: minor(watch.targetPrice),
    inStock: target.inStock,
    status: (watch.paused ? 'paused' : target.status) as WatchStatus,
    paused: watch.paused,
    isMine: watch.isMine,
    intervalSeconds: watch.intervalSeconds,
    lastCheckedAt: iso(target.lastCheckedAt),
    lastSuccessAt: iso(target.lastSuccessAt),
    history: history.get(target.id) ?? [],
  }));
}

/**
 * Someone picked a different price on the screenshot: that element becomes
 * the site's way to read its price, as products on one site share a layout.
 * The site is locked while it changes, as healing does.
 */
async function usePick(
  tx: Prisma.TransactionClient,
  siteId: string,
  targetId: string,
  selector: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sites WHERE id = ${siteId}::uuid FOR UPDATE`;
  const active = await tx.recipe.findFirst({
    where: { siteId, retiredAt: null },
    orderBy: { activeFrom: 'desc' },
  });
  if (active?.selector !== selector || active.attribute) {
    await tx.recipe.updateMany({
      where: { siteId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    await tx.recipe.create({ data: { siteId, selector, source: 'user' } });
    // A "not modified" answer would keep the old reading: ask each page for itself again.
    await tx.target.updateMany({ where: { siteId }, data: { etag: null, lastModified: null } });
  }
  // Read it the new way straight away.
  await tx.target.update({ where: { id: targetId }, data: { nextCheckAt: new Date() } });
}

const isConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const idParams = z.object({ id: z.uuid() });
const checksQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

/** The watchlist: every route works inside the signed-in person's workspace and nowhere else. */
export async function watchRoutes(app: FastifyInstance, deps: WatchDeps) {
  const { db, wake } = deps;
  const now = deps.now ?? Date.now;

  /** One of this workspace's watches. Another workspace's id looks exactly like a missing one. */
  async function find(workspaceId: string, params: unknown) {
    const parsed = idParams.safeParse(params);
    if (!parsed.success) return null;
    return db.watch.findFirst({ where: { id: parsed.data.id, workspaceId }, include });
  }
  const notFound = (reply: FastifyReply) =>
    reply.code(404).send({ error: 'We couldn’t find that product.' });
  const refuse = (reply: FastifyReply, field: string, error: string) =>
    reply.code(422).send({ error, field });
  const summaryOf = async (id: string, since: Date | null) => {
    const row = await db.watch.findUniqueOrThrow({ where: { id }, include });
    return (await summarise(db, [row], since))[0]!;
  };
  const recent = () => new Date(now() - HISTORY_DAYS * DAY_MS);

  app.get('/api/watches', async (request) => {
    const rows = await db.watch.findMany({
      where: { workspaceId: request.member!.workspaceId },
      include,
      orderBy: { createdAt: 'desc' },
    });
    return { watches: await summarise(db, rows, recent()) };
  });

  interface NewWatch {
    address: string;
    label?: string;
    targetPrice?: number;
    intervalSeconds: number;
    /** A selector someone picked on a preview, to become the site's way to read its price. */
    picked?: string | null;
    needsBrowser?: boolean;
    title?: string | null;
  }
  type Added =
    { ok: true; id: string; created: boolean } | { ok: false; field: string; error: string };
  interface Workspace {
    id: string;
    isDemo: boolean;
    maxWatches: number;
    /** Counted as products are added, so a bulk add stops at the limit too. */
    watches: number;
  }

  /** Adds one product to a workspace: the same rules for one address or fifty. */
  async function addWatch(workspace: Workspace, input: NewWatch): Promise<Added> {
    const vetted = await vetAddress(deps, workspace, input.address);
    if (!vetted.ok) return vetted;
    const { site, url } = vetted;
    if (input.intervalSeconds < SHORTEST_REAL_INTERVAL && !site.demoAllowed) {
      return {
        ok: false,
        field: 'intervalSeconds',
        error: 'Every 15 minutes is for the practice shops. Real shops are checked hourly at most.',
      };
    }
    const title = input.title ?? null;

    const save = () =>
      db.$transaction(async (tx) => {
        const target = await tx.target.upsert({
          where: { canonicalUrl: url },
          update: {},
          create: {
            siteId: site.id,
            url,
            canonicalUrl: url,
            intervalSeconds: input.intervalSeconds,
            title,
          },
        });
        const existing = await tx.watch.findUnique({
          where: { workspaceId_targetId: { workspaceId: workspace.id, targetId: target.id } },
        });
        if (!existing && workspace.watches >= workspace.maxWatches) return null;

        if (title && !target.title) {
          await tx.target.update({ where: { id: target.id }, data: { title } });
        }
        if (input.needsBrowser && !site.needsBrowser) {
          await tx.site.update({ where: { id: site.id }, data: { needsBrowser: true } });
        }
        if (input.picked) await usePick(tx, site.id, target.id, input.picked);
        if (existing) return { id: existing.id, created: false };

        const watch = await tx.watch.create({
          data: {
            workspaceId: workspace.id,
            targetId: target.id,
            label: input.label || null,
            targetPrice: input.targetPrice === undefined ? null : BigInt(input.targetPrice),
            intervalSeconds: input.intervalSeconds,
          },
        });
        await syncTarget(tx, target.id);
        return { id: watch.id, created: true };
      });
    // Two people adding the same page at the same moment: the loser finds the winner's rows.
    const saved = await save().catch((error: unknown) => {
      if (isConflict(error)) return save();
      throw error;
    });
    if (!saved) {
      return {
        ok: false,
        field: 'url',
        error: `This workspace can watch up to ${workspace.maxWatches} products.`,
      };
    }
    if (saved.created) workspace.watches++;
    return { ok: true, ...saved };
  }

  async function workspaceOf(workspaceId: string): Promise<Workspace> {
    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: { _count: { select: { watches: true } } },
    });
    return { ...workspace, watches: workspace._count.watches };
  }

  /** A finished preview of this workspace's, or why it can't be used. */
  async function finishedPreview(workspaceId: string, previewId: string, address: string) {
    const preview = await deps.previews.get(previewId, workspaceId);
    const result = preview?.status === 'done' ? preview.result : null;
    if (!preview || !result) {
      return { ok: false, error: 'That preview has expired. Open the address again.' } as const;
    }
    const asked = cleanUrl(address);
    if (!asked.ok || asked.url !== preview.url) {
      return { ok: false, error: 'That preview was for a different address.' } as const;
    }
    return { ok: true, result } as const;
  }

  app.post('/api/watches', async (request, reply) => {
    const { workspaceId } = request.member!;
    const input = addWatchSchema.parse(request.body ?? {});

    // From a preview: save the page where it ended up, read the way that was picked.
    const fromPreview: Partial<NewWatch> = { address: input.url };
    if (input.preview) {
      const preview = await finishedPreview(workspaceId, input.preview.id, input.url);
      if (!preview.ok) return refuse(reply, 'preview', preview.error);
      const { result } = preview;
      const choice = result.choices[input.preview.choice];
      if (!choice) return refuse(reply, 'preview', 'Pick one of the prices on the screenshot.');
      fromPreview.picked = choice.best ? null : (result.selectors[input.preview.choice] ?? null);
      fromPreview.needsBrowser = result.outcome === 'ok' && result.plainHtmlWorks === false;
      fromPreview.title = result.title;
      fromPreview.address = result.url;
    }

    const added = await addWatch(await workspaceOf(workspaceId), {
      address: input.url,
      ...fromPreview,
      label: input.label,
      targetPrice: input.targetPrice,
      intervalSeconds: input.intervalSeconds,
    });
    if (!added.ok) return refuse(reply, added.field, added.error);
    if (added.created || fromPreview.picked) await wake();
    if (added.created) await deps.publish({ type: 'watches', workspaceId });
    return reply
      .code(added.created ? 201 : 200)
      .send({ watch: await summaryOf(added.id, recent()), created: added.created });
  });

  // Up to fifty at once. Each line is vetted and added like a single one, and checked
  // straight away; any whose price can't be read wait for someone to pick it.
  app.post('/api/watches/bulk', async (request) => {
    const { workspaceId } = request.member!;
    const input = bulkAddSchema.parse(request.body ?? {});
    const workspace = await workspaceOf(workspaceId);
    const results: BulkResult[] = [];
    // One line at a time: lines on the same shop would otherwise race to record it.
    for (const item of input.items) {
      const added = await addWatch(workspace, {
        address: item.url,
        label: item.label,
        targetPrice: item.targetPrice,
        intervalSeconds: input.intervalSeconds,
      });
      results.push(
        added.ok
          ? { url: item.url, ok: true, watchId: added.id, created: added.created }
          : { url: item.url, ok: false, error: added.error },
      );
    }
    if (results.some((result) => result.ok && result.created)) {
      await wake();
      await deps.publish({ type: 'watches', workspaceId });
    }
    return { results };
  });

  // Picking the price again: when nothing could find it, or the automatic pick was wrong.
  app.post('/api/watches/:id/pick', async (request, reply) => {
    const row = await find(request.member!.workspaceId, request.params);
    if (!row) return notFound(reply);
    const { preview: picked } = pickSchema.parse(request.body ?? {});
    const preview = await finishedPreview(row.workspaceId, picked.id, row.target.url);
    if (!preview.ok) return refuse(reply, 'preview', preview.error);
    const { result } = preview;
    const selector = result.selectors[picked.choice];
    if (!selector) return refuse(reply, 'preview', 'Pick one of the prices on the screenshot.');

    await db.$transaction(async (tx) => {
      if (result.outcome === 'ok' && result.plainHtmlWorks === false) {
        await tx.site.update({ where: { id: row.target.siteId }, data: { needsBrowser: true } });
      }
      // A deliberate choice, so it's saved even when it matches the automatic pick.
      await usePick(tx, row.target.siteId, row.targetId, selector);
    });
    await wake();
    await deps.publish({ type: 'watches', workspaceId: row.workspaceId });
    return { watch: await summaryOf(row.id, recent()) };
  });

  app.get('/api/watches/:id', async (request, reply) => {
    const row = await find(request.member!.workspaceId, request.params);
    if (!row) return notFound(reply);
    const [watch] = await summarise(db, [row], null);
    const events = await db.event.findMany({
      where: {
        OR: [{ targetId: row.targetId }, { siteId: row.target.siteId, targetId: null }],
      },
      orderBy: { at: 'desc' },
      take: 50,
    });
    return {
      watch: watch!,
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        at: event.at.toISOString(),
        details: event.details as Record<string, unknown>,
        siteWide: event.targetId === null,
      })),
    } satisfies WatchDetail;
  });

  app.get('/api/watches/:id/checks', async (request, reply) => {
    const row = await find(request.member!.workspaceId, request.params);
    if (!row) return notFound(reply);
    const { limit } = checksQuery.parse(request.query);
    const checks = await db.check.findMany({
      where: { targetId: row.targetId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return {
      checks: checks.map((check): CheckSummary => ({
        id: check.id,
        reason: check.reason,
        mode: check.mode,
        outcome: check.outcome,
        startedAt: check.startedAt.toISOString(),
        finishedAt: check.finishedAt.toISOString(),
        httpStatus: check.httpStatus,
        timings: check.timings as Record<string, number> | null,
        strategy: check.strategy,
        confidence: check.confidence,
        price: minor(check.price),
        currency: check.currency,
        inStock: check.inStock,
        detail: check.detail,
      })),
    };
  });

  app.patch('/api/watches/:id', async (request, reply) => {
    const row = await find(request.member!.workspaceId, request.params);
    if (!row) return notFound(reply);
    const changes = updateWatchSchema.parse(request.body ?? {});
    if (
      changes.intervalSeconds !== undefined &&
      changes.intervalSeconds < SHORTEST_REAL_INTERVAL &&
      !row.target.site.demoAllowed
    ) {
      return refuse(
        reply,
        'intervalSeconds',
        'Every 15 minutes is for the practice shops. Real shops are checked hourly at most.',
      );
    }

    await db.$transaction(async (tx) => {
      await tx.watch.update({
        where: { id: row.id },
        data: {
          label: changes.label === '' ? null : changes.label,
          targetPrice:
            changes.targetPrice === undefined
              ? undefined
              : changes.targetPrice === null
                ? null
                : BigInt(changes.targetPrice),
          intervalSeconds: changes.intervalSeconds,
          paused: changes.paused,
          isMine: changes.isMine,
        },
      });
      if (changes.intervalSeconds !== undefined || changes.paused !== undefined) {
        await syncTarget(tx, row.targetId);
      }
    });
    if (row.paused && changes.paused === false) await wake();
    await deps.publish({ type: 'watches', workspaceId: row.workspaceId });
    return { watch: await summaryOf(row.id, recent()) };
  });

  app.delete('/api/watches/:id', async (request, reply) => {
    const row = await find(request.member!.workspaceId, request.params);
    if (!row) return notFound(reply);
    // The product page and its history stay: someone else may watch it, or you may come back.
    await db.$transaction(async (tx) => {
      await tx.watch.delete({ where: { id: row.id } });
      await syncTarget(tx, row.targetId);
    });
    await deps.publish({ type: 'watches', workspaceId: row.workspaceId });
    return reply.code(204).send();
  });

  app.post('/api/watches/:id/check', async (request, reply) => {
    const row = await find(request.member!.workspaceId, request.params);
    if (!row) return notFound(reply);
    const { target } = row;
    if (row.paused || target.status === 'paused') {
      return reply.code(409).send({ error: 'This product is paused. Resume it to check it.' });
    }
    if (target.status === 'gone' && target.failureStreak >= GONE_FOR_GOOD_STREAK) {
      return reply
        .code(409)
        .send({ error: 'This page has been gone for over a week, so we’ve stopped checking it.' });
    }
    const since = target.lastCheckedAt ? now() - target.lastCheckedAt.getTime() : Infinity;
    if (since < CHECK_NOW_COOLDOWN_MS) {
      const wait = Math.ceil((CHECK_NOW_COOLDOWN_MS - since) / 1000);
      return reply
        .code(429)
        .header('retry-after', String(wait))
        .send({ error: `It was checked moments ago. Try again in ${wait} s.`, retryAfter: wait });
    }
    await db.target.update({ where: { id: target.id }, data: { nextCheckAt: new Date(now()) } });
    await wake();
    return reply.code(202).send({ queued: true });
  });
}
