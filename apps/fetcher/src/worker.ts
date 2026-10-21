import type {
  Breaker,
  CheckOutcome,
  CheckReport,
  FetchJob,
  IngestJob,
  SiteGate,
} from '@pennydrop/queue';
import { DelayedError, type Job, type Queue } from 'bullmq';
import type { CheckResult, createChecker } from './check.ts';

/** Outcomes that say the site itself is struggling: they count towards its breaker. */
const SITE_FAILURES = new Set<CheckOutcome>([
  'timeout',
  'network_error',
  'http_error',
  'blocked',
  'rate_limited',
]);
/** Outcomes that prove the site is answering properly. */
const SITE_HEALTHY = new Set<CheckOutcome>(['ok', 'unchanged', 'price_not_found', 'gone']);

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

/**
 * Runs one fetch job. The breaker and the gate come first: a failing site is
 * skipped, and a busy one puts the job back for exactly as long as it must
 * wait, so this worker takes another site's job instead of sleeping on a slot.
 */
export function createFetchProcessor(deps: FetchProcessorDeps) {
  const now = deps.now ?? Date.now;
  const leaseMs = deps.leaseMs ?? 120_000;

  return async (job: Job<FetchJob>, token?: string): Promise<void> => {
    const data = job.data;
    const id = job.id!;
    const send = (report: CheckReport) =>
      deps.ingest.add(
        'report',
        { checkJobId: id, job: data, report },
        { ...ingestJobOptions, jobId: id },
      );

    const decision = await deps.breaker.allow(data.host, id);
    if (!decision.go) {
      await send(skipped(data, decision.retryAt, deps.worker, now()));
      return;
    }

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
        etag: data.etag,
        lastModified: data.lastModified,
        robots: data.robots,
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
        health === null ? { change: null } : await deps.breaker.report(data.host, health);
      if (change.change === 'opened') notBefore = Math.max(notBefore ?? 0, change.openUntil);

      await send(
        toReport(result, deps.lane, {
          startedAt,
          finishedAt,
          notBefore,
          worker: deps.worker,
          breaker: {
            change: change.change,
            openUntil: change.change === 'opened' ? change.openUntil : null,
          },
        }),
      );
    } finally {
      await deps.gate.release(data.host, id);
    }
  };
}
