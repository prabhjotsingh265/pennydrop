import type { CheckOutcome, Db } from '@pennydrop/db';
import type { CheckFeed, CheckFeedItem, SiteSummary } from '@pennydrop/domain';
import { minorDigits } from '@pennydrop/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { screenshotPath } from '@pennydrop/queue';
import { csv, fileName } from './csv.ts';
import { zip } from './zip.ts';
import { labelFromUrl } from './watches.ts';

const GOOD: CheckOutcome[] = ['ok', 'unchanged', 'suspicious'];

const feedQuery = z.object({
  /** "problems": only checks that didn't read the page properly. */
  show: z.enum(['all', 'problems']).default('all'),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const idParams = z.object({ id: z.uuid() });

const minor = (value: bigint | null) => (value === null ? null : Number(value));
/** Minor units back to a plain decimal for spreadsheets: 3450 GBP is 34.50. */
const decimal = (value: bigint | null, currency: string | null) => {
  if (value === null) return null;
  const digits = minorDigits(currency ?? 'GBP');
  return (Number(value) / 10 ** digits).toFixed(digits);
};

interface SiteRow {
  id: string;
  host: string;
  policy: SiteSummary['policy'];
  robots_status: SiteSummary['robots']['status'];
  robots_fetched_at: Date | null;
  crawl_delay: number | null;
  min_gap_ms: number;
  max_in_flight: number;
  needs_browser: boolean;
  breaker_state: SiteSummary['breaker']['state'];
  breaker_open_until: Date | null;
  products: number;
}

/** The Sites and Checks pages, and CSV exports: all of it inside the signed-in workspace. */
export async function reportRoutes(
  app: FastifyInstance,
  { db, screenshotDir }: { db: Db; screenshotDir?: string },
) {
  app.get('/api/sites', async (request): Promise<{ sites: SiteSummary[] }> => {
    const { workspaceId } = request.member!;
    const sites = await db.$queryRaw<SiteRow[]>`
      SELECT s.id, s.host, s.policy::text AS policy, s.robots_status::text AS robots_status,
             s.robots_fetched_at, s.crawl_delay, s.min_gap_ms, s.max_in_flight, s.needs_browser,
             s.breaker_state::text AS breaker_state, s.breaker_open_until,
             COUNT(w.id)::int AS products
      FROM watches w
      JOIN targets t ON t.id = w.target_id
      JOIN sites s ON s.id = t.site_id
      WHERE w.workspace_id = ${workspaceId}::uuid
      GROUP BY s.id
      ORDER BY s.host`;
    if (!sites.length) return { sites: [] };
    const ids = sites.map((site) => site.id);

    // Only this workspace's own checks count: other people's products stay their business.
    const stats = await db.$queryRaw<
      { site_id: string; checks: number; good: number; median_ms: number | null }[]
    >`
      SELECT t.site_id, COUNT(*)::int AS checks,
             COUNT(*) FILTER (WHERE c.outcome IN ('ok', 'unchanged', 'suspicious'))::int AS good,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (c.finished_at - c.started_at)) * 1000
             )::float8 AS median_ms
      FROM checks c
      JOIN targets t ON t.id = c.target_id
      WHERE c.started_at > now() - interval '24 hours'
        AND c.target_id IN (SELECT target_id FROM watches WHERE workspace_id = ${workspaceId}::uuid)
      GROUP BY t.site_id`;
    const recipes = await db.recipe.findMany({
      where: { siteId: { in: ids }, retiredAt: null },
      orderBy: { activeFrom: 'desc' },
    });
    const statsFor = new Map(stats.map((row) => [row.site_id, row]));
    const recipeFor = new Map<string, (typeof recipes)[number]>();
    for (const recipe of recipes)
      if (!recipeFor.has(recipe.siteId)) recipeFor.set(recipe.siteId, recipe);

    return {
      sites: sites.map((site) => {
        const day = statsFor.get(site.id);
        const recipe = recipeFor.get(site.id);
        return {
          id: site.id,
          host: site.host,
          products: site.products,
          policy: site.policy,
          robots: {
            status: site.robots_status,
            fetchedAt: site.robots_fetched_at?.toISOString() ?? null,
          },
          crawlDelay: site.crawl_delay,
          minGapMs: site.min_gap_ms,
          maxInFlight: site.max_in_flight,
          needsBrowser: site.needs_browser,
          breaker: {
            state: site.breaker_state,
            openUntil: site.breaker_open_until?.toISOString() ?? null,
          },
          recipe: recipe
            ? {
                selector: recipe.selector,
                attribute: recipe.attribute,
                source: recipe.source,
                since: recipe.activeFrom.toISOString(),
              }
            : null,
          lastDay: {
            checks: day?.checks ?? 0,
            good: day?.good ?? 0,
            medianMs: day?.median_ms ?? null,
          },
        };
      }),
    };
  });

  app.get('/api/checks', async (request): Promise<CheckFeed> => {
    const { workspaceId } = request.member!;
    const { show, before, limit } = feedQuery.parse(request.query);
    const rows = await db.check.findMany({
      where: {
        target: { watches: { some: { workspaceId } } },
        ...(show === 'problems' ? { outcome: { notIn: GOOD } } : {}),
        ...(before ? { startedAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: limit + 1,
      include: {
        target: {
          select: {
            title: true,
            url: true,
            watches: { where: { workspaceId }, select: { id: true, label: true } },
          },
        },
      },
    });
    const page = rows.slice(0, limit);
    return {
      checks: page.map((check): CheckFeedItem => {
        const watch = check.target.watches[0]!;
        return {
          id: check.id,
          watchId: watch.id,
          label: watch.label ?? check.target.title ?? labelFromUrl(check.target.url),
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
          screenshot: check.screenshotKey !== null,
        };
      }),
      next: rows.length > limit ? page.at(-1)!.startedAt.toISOString() : null,
    };
  });

  // A failed check's screenshot, for a workspace that watches that page, while it's kept.
  app.get('/api/checks/:id/screenshot', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const check = params.success
      ? await db.check.findFirst({
          where: {
            id: params.data.id,
            screenshotKey: { not: null },
            target: { watches: { some: { workspaceId: request.member!.workspaceId } } },
          },
          select: { screenshotKey: true },
        })
      : null;
    const path =
      check && screenshotDir ? screenshotPath(screenshotDir, check.screenshotKey!) : null;
    const image = path ? await readFile(path).catch(() => null) : null;
    if (!image) return reply.code(404).send({ error: 'That screenshot is no longer kept.' });
    return reply.type('image/jpeg').header('cache-control', 'private, max-age=86400').send(image);
  });

  /** The workspace's products as a spreadsheet: one row each. */
  async function watchlistCsv(workspaceId: string): Promise<string> {
    const watches = await db.watch.findMany({
      where: { workspaceId },
      include: { target: { include: { site: { select: { host: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const rows = watches.map(({ target, ...watch }) => [
      watch.label ?? target.title ?? labelFromUrl(target.url),
      target.site.host,
      target.url,
      decimal(target.currentPrice, target.currency),
      target.currency,
      decimal(watch.targetPrice, target.currency),
      watch.paused ? 'paused' : target.status,
      watch.intervalSeconds / 60,
      target.lastSuccessAt?.toISOString() ?? null,
    ]);
    return csv([
      [
        'name',
        'shop',
        'address',
        'price',
        'currency',
        'target',
        'status',
        'check_every_minutes',
        'last_read',
      ],
      ...rows,
    ]);
  }

  /** Every price each product has had, as change points: one row per price, from first seen to last. */
  async function historyCsv(workspaceId: string): Promise<string> {
    const watches = await db.watch.findMany({
      where: { workspaceId },
      include: { target: { include: { pricePoints: { orderBy: { firstSeenAt: 'asc' } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const rows = watches.flatMap(({ target, ...watch }) =>
      target.pricePoints.map((point) => [
        watch.label ?? target.title ?? labelFromUrl(target.url),
        target.url,
        point.firstSeenAt.toISOString(),
        point.lastSeenAt.toISOString(),
        decimal(point.price, point.currency),
        decimal(point.wasPrice, point.currency),
        point.currency,
        point.inStock,
      ]),
    );
    return csv([
      ['name', 'address', 'first_seen', 'last_seen', 'price', 'was_price', 'currency', 'in_stock'],
      ...rows,
    ]);
  }

  app.get('/api/watches.csv', async (request, reply) =>
    reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="pennydrop-watchlist.csv"')
      .send(await watchlistCsv(request.member!.workspaceId)),
  );

  // Everything this workspace has, to take elsewhere: a ZIP of spreadsheets.
  app.get('/api/export', async (request, reply) => {
    const { workspaceId } = request.member!;
    const day = new Date().toISOString().slice(0, 10);
    const archive = zip([
      { name: 'products.csv', data: await watchlistCsv(workspaceId) },
      { name: 'price-history.csv', data: await historyCsv(workspaceId) },
    ]);
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="pennydrop-export-${day}.zip"`)
      .send(archive);
  });

  app.get('/api/watches/:id/history.csv', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const watch = params.success
      ? await db.watch.findFirst({
          where: { id: params.data.id, workspaceId: request.member!.workspaceId },
          include: { target: true },
        })
      : null;
    if (!watch) return reply.code(404).send({ error: 'We couldn’t find that product.' });
    const points = await db.pricePoint.findMany({
      where: { targetId: watch.targetId },
      orderBy: { firstSeenAt: 'asc' },
    });
    const label = watch.label ?? watch.target.title ?? labelFromUrl(watch.target.url);
    // Each row is a price as it stood from one moment to another: history as change points.
    const rows = points.map((point) => [
      point.firstSeenAt.toISOString(),
      point.lastSeenAt.toISOString(),
      decimal(point.price, point.currency),
      decimal(point.wasPrice, point.currency),
      point.currency,
      point.inStock,
      point.replayed,
    ]);
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${fileName(label)}-price-history.csv"`)
      .send(
        csv([
          ['first_seen', 'last_seen', 'price', 'was_price', 'currency', 'in_stock', 'replayed'],
          ...rows,
        ]),
      );
  });
}
