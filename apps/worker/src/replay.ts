import type { Db } from '@pennydrop/db';
import { checkJobId, type FetchJob } from '@pennydrop/queue';
import type { Queue } from 'bullmq';
import { jobOptions } from './dispatch.ts';
import { gapFor } from './schedule.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** One reading every six hours: as often as a product's price can drift at the practice shop. */
export const REPLAY_STEP_MS = 6 * HOUR;
export const REPLAY_DAYS = 60;
/** A new product's live checks wait for its history at most this long, even if a replay stalls. */
export const REPLAY_HOLD_MS = 2 * HOUR;
/** Replays wait behind every other check. */
const REPLAY_PRIORITY = 100;

export interface ReplayDeps {
  db: Db;
  http: Queue<FetchJob>;
  now?: () => number;
}

async function queueStep(http: Queue<FetchJob>, job: FetchJob) {
  await http.add('check', job, {
    ...jobOptions,
    jobId: checkJobId(job),
    priority: REPLAY_PRIORITY,
  });
}

/**
 * Starts replaying a product's history: a reading every `stepMs` from `days`
 * ago up to its first real reading (or now, when it has none). Run again, it
 * carries on after the last moment already replayed, or reaches further back
 * when asked for more days. Each reading is a real
 * fetch of the practice shop's page as it was, through the real extraction.
 * Returns how many readings are queued to come: 0 when there's nothing to do,
 * null when a replay of the product is already under way.
 */
export async function startReplay(
  deps: ReplayDeps,
  targetId: string,
  { days = REPLAY_DAYS, stepMs = REPLAY_STEP_MS } = {},
): Promise<number | null> {
  const now = deps.now?.() ?? Date.now();
  // One replay at a time per product: a second would fetch every moment twice.
  const queued = await deps.http.getJobs(['prioritized', 'waiting', 'delayed', 'active']);
  if (queued.some((job) => job.data.reason === 'replay' && job.data.targetId === targetId)) {
    return null;
  }
  const target = await deps.db.target.findUniqueOrThrow({
    where: { id: targetId },
    include: {
      site: {
        include: { recipes: { where: { retiredAt: null }, orderBy: { activeFrom: 'desc' } } },
      },
    },
  });
  const firstLive = await deps.db.pricePoint.findFirst({
    where: { targetId, replayed: false },
    orderBy: { firstSeenAt: 'asc' },
    select: { firstSeenAt: true },
  });
  const [earliest, latest] = await Promise.all(
    (['asc', 'desc'] as const).map((order) =>
      deps.db.pricePoint.findFirst({
        where: { targetId, replayed: true },
        orderBy: { lastSeenAt: order },
        select: { firstSeenAt: true, lastSeenAt: true },
      }),
    ),
  );
  const until = firstLive?.firstSeenAt.getTime() ?? now;
  const start = until - days * DAY;
  // Carry on after what's been replayed, if it reaches back far enough; otherwise begin at the
  // start, and the moments already known are passed over as they come.
  const from =
    earliest && latest && earliest.firstSeenAt.getTime() <= start + stepMs
      ? latest.lastSeenAt.getTime() + stepMs
      : start;
  if (from >= until) return 0;

  // A product with no history yet waits for it, so its first live reading comes after the replayed ones.
  if (!firstLive) {
    await deps.db.target.update({
      where: { id: targetId },
      data: { nextCheckAt: new Date(now + REPLAY_HOLD_MS) },
    });
  }
  const { site } = target;
  const recipe = site.recipes[0];
  await queueStep(deps.http, {
    targetId,
    siteId: site.id,
    host: site.host,
    url: target.url,
    reason: 'replay',
    scheduledFor: from,
    mode: 'http',
    recipe: recipe
      ? {
          id: recipe.id,
          selector: recipe.selector,
          attribute: recipe.attribute,
          pattern: recipe.pattern,
        }
      : null,
    etag: null,
    lastModified: null,
    robots: null,
    gapMs: gapFor({ minGapMs: site.minGapMs, crawlDelay: site.crawlDelay }),
    maxInFlight: site.maxInFlight,
    currency: target.currency,
    replay: { until, stepMs, run: now },
  });
  return Math.ceil((until - from) / stepMs);
}

/**
 * After a replayed reading is recorded: the next moment, or, at the end, the
 * product's live checks begin (if they were waiting for its history).
 */
export async function continueReplay(deps: ReplayDeps, job: FetchJob): Promise<'next' | 'done'> {
  const { until, stepMs } = job.replay!;
  const next = job.scheduledFor + stepMs;
  if (next < until) {
    await queueStep(deps.http, { ...job, scheduledFor: next });
    return 'next';
  }
  const live = await deps.db.pricePoint.count({
    where: { targetId: job.targetId, replayed: false },
  });
  if (live === 0) {
    await deps.db.target.update({
      where: { id: job.targetId },
      data: { nextCheckAt: new Date(deps.now?.() ?? Date.now()) },
    });
  }
  return 'done';
}
