export const QUEUES = {
  /** Every 15 s: due products from PostgreSQL into the fetch queues. */
  dispatch: 'dispatch',
  /** Plain HTTP checks: cheap, many at once. */
  fetchHttp: 'fetch-http',
  /** Chromium checks: heavy, a few at once. */
  fetchBrowser: 'fetch-browser',
  /** Results, written to the database by a worker that has it. */
  ingest: 'ingest',
  maintenance: 'maintenance',
} as const;

export type CheckOutcome =
  | 'ok'
  | 'unchanged'
  | 'suspicious'
  | 'price_not_found'
  | 'blocked'
  | 'rate_limited'
  | 'http_error'
  | 'gone'
  | 'robots_disallowed'
  | 'timeout'
  | 'network_error'
  | 'too_large'
  | 'not_html'
  | 'blocked_address'
  | 'skipped_breaker_open';

export type CheckReason = 'scheduled' | 'manual' | 'preview' | 'confirm' | 'replay';

export interface RobotsSnapshot {
  status: 'ok' | 'missing' | 'unreachable';
  body: string;
  fetchedAt: number;
}

/** Everything a fetcher needs, so it never has to read the database. */
export interface FetchJob {
  targetId: string;
  siteId: string;
  host: string;
  url: string;
  reason: CheckReason;
  /** When the check was due, in ms since the epoch. */
  scheduledFor: number;
  mode: 'auto' | 'http' | 'browser';
  recipe: { id: string; selector: string; attribute: string | null; pattern: string | null } | null;
  etag: string | null;
  lastModified: string | null;
  robots: RobotsSnapshot | null;
  gapMs: number;
  maxInFlight: number;
  /** The currency the product was last seen in, to settle "$" and "kr". */
  currency: string | null;
}

/** One strategy's reading, kept for "show me why". */
export interface Reading {
  strategy: string;
  status: 'found' | 'missing' | 'skipped';
  amount: number | null;
  confidence: number | null;
  note: string | null;
}

/** What a fetcher found, for the worker with the database to record. */
export interface CheckReport {
  outcome: CheckOutcome;
  mode: 'http' | 'browser';
  status: number | null;
  url: string;
  amount: number | null;
  currency: string | null;
  was: number | null;
  inStock: boolean | null;
  confidence: number | null;
  strategy: string | null;
  conflict: boolean;
  /** Where the price sits, when a selector can point at it: the healing candidate. */
  locator: string | null;
  readings: Reading[];
  neededBrowser: boolean;
  retryAfterSeconds: number | null;
  etag: string | null;
  lastModified: string | null;
  /** The robots.txt copy used, when it was fetched fresh. */
  robots: RobotsSnapshot | null;
  crawlDelay: number | null;
  detail: string;
  timings: Record<string, number>;
  startedAt: number;
  finishedAt: number;
  breaker: { change: 'opened' | 'closed' | null; openUntil: number | null };
  worker: string;
}

export interface IngestJob {
  /** The fetch job's id: the check is recorded once, even if this job runs twice. */
  checkJobId: string;
  job: FetchJob;
  report: CheckReport;
}

/**
 * One job per product per due time, so queueing it twice does nothing. BullMQ
 * ids can't contain ":", hence the dashes.
 */
export function checkJobId(job: Pick<FetchJob, 'reason' | 'targetId' | 'scheduledFor'>): string {
  return `${job.reason}-${job.targetId}-${job.scheduledFor}`;
}
