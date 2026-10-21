import { GONE_FOR_GOOD_STREAK, Prisma, syncTarget, type Db } from '@pennydrop/db';
import {
  addWatchSchema,
  updateWatchSchema,
  type CheckSummary,
  type WatchDetail,
  type WatchStatus,
  type WatchSummary,
} from '@pennydrop/domain';
import { cleanUrl, siteOf } from '@pennydrop/fetch';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { isPrivateHost, type Lookup } from './addresses.ts';

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 30;
/** "Check now" waits this long after the last check. */
const CHECK_NOW_COOLDOWN_MS = 60_000;
/** Real shops are checked hourly at most; every 15 minutes is for the practice shops. */
const SHORTEST_REAL_INTERVAL = 3_600;

export interface WatchDeps {
  db: Db;
  /** Asks the dispatcher to run now rather than at its next tick. */
  wake: () => Promise<void>;
  /** Development: allow the practice shops at *.localhost. */
  localShops: boolean;
  lookup: Lookup;
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

const isConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const URL_ERRORS = {
  'not-a-url': 'That doesn’t look like a product page address.',
  'not-http': 'That doesn’t look like a product page address.',
  'has-credentials': 'Addresses with a username or password in them can’t be checked.',
} as const;

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

  app.post('/api/watches', async (request, reply) => {
    const { workspaceId } = request.member!;
    const input = addWatchSchema.parse(request.body ?? {});
    const clean = cleanUrl(input.url);
    if (!clean.ok) return refuse(reply, 'url', URL_ERRORS[clean.error]);
    const hostname = new URL(clean.url).hostname;
    if (await isPrivateHost(hostname, deps)) {
      return refuse(reply, 'url', 'We can’t check addresses inside private networks.');
    }

    const workspace = await db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: { _count: { select: { watches: true } } },
    });
    const site = await db.site.upsert({
      where: { host: hostname },
      update: {},
      create: {
        host: hostname,
        registrable: siteOf(hostname),
        demoAllowed: deps.localShops && hostname.endsWith('.localhost'),
      },
    });
    if (site.policy !== 'allowed') {
      return refuse(
        reply,
        'url',
        site.policy === 'api_only'
          ? 'This shop doesn’t allow automated checks. It offers an API instead.'
          : 'This shop doesn’t allow automated checks.',
      );
    }
    if (workspace.isDemo && !site.demoAllowed) {
      return refuse(
        reply,
        'url',
        'The demo only checks the practice shops. Run Pennydrop yourself to track anything.',
      );
    }
    if (input.intervalSeconds < SHORTEST_REAL_INTERVAL && !site.demoAllowed) {
      return refuse(
        reply,
        'intervalSeconds',
        'Every 15 minutes is for the practice shops. Real shops are checked hourly at most.',
      );
    }

    const save = () =>
      db.$transaction(async (tx) => {
        const target = await tx.target.upsert({
          where: { canonicalUrl: clean.url },
          update: {},
          create: {
            siteId: site.id,
            url: clean.url,
            canonicalUrl: clean.url,
            intervalSeconds: input.intervalSeconds,
          },
        });
        const existing = await tx.watch.findUnique({
          where: { workspaceId_targetId: { workspaceId, targetId: target.id } },
        });
        if (existing) return { id: existing.id, created: false };
        if (workspace._count.watches >= workspace.maxWatches) return null;
        const watch = await tx.watch.create({
          data: {
            workspaceId,
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
      return refuse(
        reply,
        'url',
        `This workspace can watch up to ${workspace.maxWatches} products.`,
      );
    }
    if (saved.created) await wake();
    return reply
      .code(saved.created ? 201 : 200)
      .send({ watch: await summaryOf(saved.id, recent()), created: saved.created });
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
