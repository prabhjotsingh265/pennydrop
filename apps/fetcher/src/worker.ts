import type {
  Breaker,
  CheckOutcome,
  CheckReport,
  FetchJob,
  IngestJob,
  SiteGate,
} from '@pennydrop/queue';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { replayHeaders } from '@pennydrop/fetch';
import { screenshotPath } from '@pennydrop/queue';
import { DelayedError, type Job, type Queue } from 'bullmq';
import type { CheckResult, createChecker } from './check.ts';

/** Outcomes that say the site itself is struggling: they count towards its breaker. */
export const SITE_FAILURES = new Set<CheckOutcome>([
  'timeout',
  'network_error',
  'http_error',
  'blocked',
  'rate_limited',
]);
/** Outcomes that prove the site is answering properly. */
export const SITE_HEALTHY = new Set<CheckOutcome>(['ok', 'unchanged', 'price_not_found', 'gone']);

export const ingestJobOptions = {
  // If the database blinks, the result waits and tries again rather than being lost.
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

export interface FetchProcessorDeps {
  checker: ReturnType<typeof createChecker>;
  gate: SiteGate;
  breaker: Breaker;
  ingest: Queue<IngestJob>;
  lane: 'http' | 'browser';
  /** This process's name, for the check log. */
  worker: string;
  /** How long a gate slot is held before it's taken back from a crashed worker. */
  leaseMs?: number;
  /** Where failed browser checks leave their screenshots. Without it, none are kept. */
  screenshotDir?: string;
  /** Signs replays' past moments for the practice shop. Without it, replays fail. */
  replaySecret?: string;
  now?: () => number;
}

type Extra = Pick<CheckReport, 'startedAt' | 'finishedAt' | 'breaker' | 'worker' | 'notBefore'>;

/** A check's result, flattened into what the ingest worker records. */
export function toReport(result: CheckResult, lane: 'http' | 'browser', extra: Extra): CheckReport {
  const extraction = result.extraction;
  return {
    outcome: result.outcome,
    mode: result.mode,
    status: result.status,
    url: result.url,
    amount: extraction?.amount ?? null,
    currency: extraction?.currency ?? null,
    was: extraction?.was ?? null,
    inStock: extraction?.inStock ?? null,
    confidence: extraction?.amount === null || !extraction ? null : extraction.confidence,
    strategy: extraction?.strategy ?? null,
    conflict: extraction?.conflict ?? false,
    locator: extraction?.locator ?? null,
    locatorAttribute: extraction?.locatorAttribute ?? null,
    readings: (extraction?.results ?? []).map((r) => ({
      strategy: r.strategy,
      status: r.status,
      amount: r.candidates[0]?.amount ?? null,
      confidence: r.candidates[0]?.confidence ?? null,
      note: r.candidates[0]?.note ?? null,
    })),
    neededBrowser: result.neededBrowser,
    wantsBrowser: lane === 'http' && result.outcome === 'price_not_found',
    retryAfterSeconds: result.retryAfterSeconds,
    etag: result.etag,
    lastModified: result.lastModified,
    robots: result.robots,
    crawlDelay: result.crawlDelay,
    detail: result.detail,
    timings: result.timings,
    ...extra,
  };
}

function skipped(job: FetchJob, retryAt: number, worker: string, at: number): CheckReport {
  return {
    outcome: 'skipped_breaker_open',
    mode: job.mode === 'browser' ? 'browser' : 'http',
    status: null,
    url: job.url,
    amount: null,
    currency: null,
    was: null,
    inStock: null,
    confidence: null,
    strategy: null,
    conflict: false,
    locator: null,
    locatorAttribute: null,
    readings: [],
    neededBrowser: false,
    wantsBrowser: false,
    notBefore: retryAt,
    retryAfterSeconds: Math.max(0, Math.ceil((retryAt - at) / 1000)),
    etag: job.etag,
    lastModified: job.lastModified,
    robots: null,
    crawlDelay: null,
    detail: 'The site has been failing, so it’s being left alone for a while.',
    timings: {},
    startedAt: at,
    finishedAt: at,
    breaker: { change: null, openUntil: retryAt },
    worker,
  };
}

/** A failed check's picture, saved under its job id for the check log. Never fails the check. */
export async function keepScreenshot(
  dir: string | undefined,
  key: string,
  result: Pick<CheckResult, 'outcome' | 'screenshot'>,
): Promise<boolean> {
  const path = dir ? screenshotPath(dir, key) : null;
  if (!path || !result.screenshot || SITE_HEALTHY_READS.has(result.outcome)) return false;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, result.screenshot);
    return true;
  } catch (error) {
    console.error(`screenshot for ${key} not kept:`, error);
    return false;
  }
}

/** A check, as the logs tell it. Small: BullMQ keeps it with the finished job. */
export interface CheckSummary {
  outcome: CheckOutcome;
  ms: number;
  strategy: string | null;
  breaker: 'opened' | 'closed' | null;
}

/** Outcomes that read the page properly: nothing to look into. */
const SITE_HEALTHY_READS = new Set<CheckOutcome>(['ok', 'unchanged', 'suspicious']);

/**
 * Runs one fetch job. The breaker and the gate come first: a failing site is
 * skipped, and a busy one puts the job back for exactly as long as it must
 * wait, so this worker takes another site's job instead of sleeping on a slot.
 */
export function createFetchProcessor(deps: FetchProcessorDeps) {
  const now = deps.now ?? Date.now;
  const leaseMs = deps.leaseMs ?? 120_000;

  return async (job: Job<FetchJob>, token?: string): Promise<CheckSummary> => {
    const data = job.data;
    const id = job.id!;
    const send = async (report: CheckReport): Promise<CheckSummary> => {
      await deps.ingest.add(
        'report',
        { checkJobId: id, job: data, report },
        { ...ingestJobOptions, jobId: id },
      );
      return {
        outcome: report.outcome,
        ms: report.finishedAt - report.startedAt,
        strategy: report.strategy,
        breaker: report.breaker.change,
      };
    };

    // A replay must reach the shop signed; unsigned, it would answer with today's page.
    const replay = data.reason === 'replay';
    if (replay && !deps.replaySecret) {
      return send({
        ...skipped(data, now(), deps.worker, now()),
        outcome: 'http_error',
        detail: 'Replays aren’t set up on this fetcher: REPLAY_SECRET is missing.',
        notBefore: null,
        retryAfterSeconds: null,
        breaker: { change: null, openUntil: null },
      });
    }

    // A replay neither asks the breaker nor tells it: the shop answers replays without its
    // staged failures, so they say nothing about how the live site is doing.
    const decision = replay ? { go: true as const } : await deps.breaker.allow(data.host, id);
    if (!decision.go) return send(skipped(data, decision.retryAt, deps.worker, now()));

    const wait = await deps.gate.acquire(
      data.host,
      { gapMs: data.gapMs, maxInFlight: data.maxInFlight, leaseMs },
      id,
    );
    if (wait > 0) {
      await job.moveToDelayed(now() + wait, token);
      throw new DelayedError();
    }

    try {
      const startedAt = now();
      const result = await deps.checker.check({
        url: data.url,
        recipe: data.recipe,
        mode: deps.lane === 'browser' ? 'browser' : 'http',
        // A replay wants the past page itself, never "unchanged since", which only today's can say.
        etag: replay ? null : data.etag,
        lastModified: replay ? null : data.lastModified,
        robots: data.robots,
        headers: replay ? replayHeaders(data.scheduledFor, deps.replaySecret!) : undefined,
      });
      const finishedAt = now();

      // "Slow down": nobody asks this site again until it said we could.
      let notBefore: number | null = null;
      if (result.outcome === 'rate_limited') {
        notBefore = finishedAt + (result.retryAfterSeconds ?? 60) * 1000;
        await deps.gate.holdUntil(data.host, notBefore);
      }

      const health = SITE_FAILURES.has(result.outcome)
        ? false
        : SITE_HEALTHY.has(result.outcome)
          ? true
          : null;
      const change =
        health === null || replay ? { change: null } : await deps.breaker.report(data.host, health);
      if (change.change === 'opened') notBefore = Math.max(notBefore ?? 0, change.openUntil);

      return await send({
        ...toReport(result, deps.lane, {
          startedAt,
          finishedAt,
          notBefore,
          worker: deps.worker,
          breaker: {
            change: change.change,
            openUntil: change.change === 'opened' ? change.openUntil : null,
          },
        }),
        screenshot: await keepScreenshot(deps.screenshotDir, id, result),
      });
    } finally {
      await deps.gate.release(data.host, id);
    }
  };
}
