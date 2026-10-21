import type { PreviewChoice, PreviewShown } from '@pennydrop/domain';

export type { PreviewChoice };

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
  /** Someone adding a product: a screenshot with every price boxed. Runs on the browser fetcher. */
  preview: 'preview',
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
  /** The attribute to read at the locator, when the price isn't its text. */
  locatorAttribute: string | null;
  readings: Reading[];
  neededBrowser: boolean;
  /** The plain-HTTP lane found no price in the HTML: worth a try in a browser. */
  wantsBrowser: boolean;
  /** Don't check this site again before this moment (a 429, or the breaker's cooldown). */
  notBefore: number | null;
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

/** A preview for someone adding a product. Like a fetch job, it carries all the fetcher needs. */
export interface PreviewJob {
  url: string;
  host: string;
  /** Whose preview it is. Only the API reads it: a preview is shown to its own workspace alone. */
  workspaceId: string;
  robots: RobotsSnapshot | null;
  gapMs: number;
  maxInFlight: number;
}

/** What the browser fetcher sends back: what the person sees, plus what only the API may read. */
export interface PreviewResult extends PreviewShown {
  outcome: CheckOutcome;
  /** Selectors for the choices, in the same order. Kept back from the browser: the API reads them when a choice is saved. */
  selectors: string[];
}

/** Previews, and their screenshots, are kept this long: time enough to pick a price and save. */
export const PREVIEW_KEEP_S = 1_800;
export const previewScreenshotKey = (id: string) => `pennydrop:preview:${id}:screenshot`;
