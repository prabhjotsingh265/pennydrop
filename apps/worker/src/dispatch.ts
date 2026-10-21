import type { Db } from '@pennydrop/db';
import { checkJobId, type FetchJob } from '@pennydrop/queue';
import type { Queue } from 'bullmq';
import { gapFor, nextDue, stretch } from './schedule.ts';

const ROBOTS_FRESH_MS = 24 * 3_600_000;

interface DueRow {
  id: string;
  site_id: string;
  url: string;
  interval_seconds: number;
  next_check_at: Date;
  etag: string | null;
  last_modified: string | null;
  currency: string | null;
  host: string;
  min_gap_ms: number;
  max_in_flight: number;
  crawl_delay: number | null;
  needs_browser: boolean;
  robots_txt: string | null;
  robots_status: 'ok' | 'missing' | 'unreachable' | null;
  robots_fetched_at: Date | null;
}

export interface DispatchQueues {
  http: Queue<FetchJob>;
  browser: Queue<FetchJob>;
}

export interface DispatchOptions {
  /** At most this many products per tick. */
  batch?: number;
  /** Stop adding work while this many fetch jobs are already waiting. */
  maxQueued?: number;
  now?: () => number;
}

export interface DispatchResult {
  dispatched: number;
  /** Fetch jobs already waiting when the tick began. */
  backlog: number;
  /** True when the queues were too full to add anything. */
  held: boolean;
}

async function backlogOf(queue: Queue): Promise<number> {
  const counts = await queue.getJobCounts('waiting', 'delayed', 'prioritized', 'active');
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export const jobOptions = {
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

/**
 * One tick of the schedule: claims products that are due, gives each its next
 * due time (stretched to fit its site's pace), and queues a fetch job for it.
 * PostgreSQL owns the schedule; the queue only holds the work in hand.
 */
export async function dispatch(
  db: Db,
  queues: DispatchQueues,
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const { batch = 500, maxQueued = 5_000, now = Date.now } = options;
  const backlog = (await backlogOf(queues.http)) + (await backlogOf(queues.browser));
  const room = Math.min(batch, maxQueued - backlog);
  if (room <= 0) return { dispatched: 0, backlog, held: true };

  return db.$transaction(
    async (tx) => {
      // SKIP LOCKED: two dispatchers never claim the same product, and neither waits on the other.
      const due = await tx.$queryRaw<DueRow[]>`
        SELECT t.id, t.site_id, t.url, t.interval_seconds, t.next_check_at, t.etag, t.last_modified,
               t.currency, s.host, s.min_gap_ms, s.max_in_flight, s.crawl_delay, s.needs_browser,
               s.robots_txt, s.robots_status::text AS robots_status, s.robots_fetched_at
        FROM targets t
        JOIN sites s ON s.id = t.site_id
        WHERE t.status = 'active' AND s.policy = 'allowed' AND t.next_check_at <= ${new Date(now())}
        ORDER BY t.next_check_at
        LIMIT ${room}
        FOR UPDATE OF t SKIP LOCKED`;
      if (due.length === 0) return { dispatched: 0, backlog, held: false };

      const siteIds = [...new Set(due.map((row) => row.site_id))];
      const wanted = await tx.$queryRaw<{ site_id: string; per_hour: number }[]>`
        SELECT site_id, SUM(3600.0 / interval_seconds)::float8 AS per_hour
        FROM targets
        WHERE status = 'active' AND site_id = ANY(${siteIds}::uuid[])
        GROUP BY site_id`;
      const recipes = await tx.$queryRaw<
        {
          id: string;
          site_id: string;
          selector: string;
          attribute: string | null;
          pattern: string | null;
        }[]
      >`
        SELECT DISTINCT ON (site_id) id, site_id, selector, attribute, pattern
        FROM recipes
        WHERE retired_at IS NULL AND site_id = ANY(${siteIds}::uuid[])
        ORDER BY site_id, active_from DESC`;
      const perHour = new Map(wanted.map((row) => [row.site_id, row.per_hour]));
      const recipeFor = new Map(recipes.map((row) => [row.site_id, row]));

      const jobs: FetchJob[] = [];
      const nexts: Date[] = [];
      for (const row of due) {
        const pace = { minGapMs: row.min_gap_ms, crawlDelay: row.crawl_delay };
        const interval = Math.round(
          row.interval_seconds * 1000 * stretch(pace, perHour.get(row.site_id) ?? 0),
        );
        nexts.push(new Date(nextDue(row.id, interval, now())));
        const recipe = recipeFor.get(row.site_id);
        const robotsFresh =
          row.robots_status &&
          row.robots_fetched_at &&
          now() - row.robots_fetched_at.getTime() < ROBOTS_FRESH_MS;
        jobs.push({
          targetId: row.id,
          siteId: row.site_id,
          host: row.host,
          url: row.url,
          reason: 'scheduled',
          scheduledFor: row.next_check_at.getTime(),
          mode: row.needs_browser ? 'browser' : 'auto',
          recipe: recipe
            ? {
                id: recipe.id,
                selector: recipe.selector,
                attribute: recipe.attribute,
                pattern: recipe.pattern,
              }
            : null,
          etag: row.etag,
          lastModified: row.last_modified,
          robots: robotsFresh
            ? {
                status: row.robots_status!,
                body: row.robots_txt ?? '',
                fetchedAt: row.robots_fetched_at!.getTime(),
              }
            : null,
          gapMs: gapFor(pace),
          maxInFlight: row.max_in_flight,
          currency: row.currency,
        });
      }

      await tx.$executeRaw`
        UPDATE targets AS t SET next_check_at = v.next
        FROM unnest(${due.map((row) => row.id)}::uuid[], ${nexts}::timestamptz[]) AS v(id, next)
        WHERE t.id = v.id`;

      // Queued before the commit: if the commit then fails, the products stay due and the
      // next tick queues them again under the same job ids, which the queue ignores.
      for (const [queue, lane] of [
        [queues.http, false],
        [queues.browser, true],
      ] as const) {
        const mine = jobs.filter((job) => (job.mode === 'browser') === lane);
        if (mine.length) {
          await queue.addBulk(
            mine.map((job) => ({
              name: 'check',
              data: job,
              opts: { ...jobOptions, jobId: checkJobId(job) },
            })),
          );
        }
      }
      return { dispatched: jobs.length, backlog, held: false };
    },
    { timeout: 30_000 },
  );
}
