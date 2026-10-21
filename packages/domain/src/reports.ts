import type { CheckSummary } from './watches.ts';

/** A shop the workspace watches something on, and how checking it is going. */
export interface SiteSummary {
  id: string;
  host: string;
  /** How many of this workspace's products are on it. */
  products: number;
  policy: 'allowed' | 'api_only' | 'blocked';
  robots: { status: 'ok' | 'missing' | 'unreachable' | null; fetchedAt: string | null };
  /** Seconds, from robots.txt. */
  crawlDelay: number | null;
  /** Our own pace: at least this long between two requests, and this many at once. */
  minGapMs: number;
  maxInFlight: number;
  needsBrowser: boolean;
  breaker: { state: 'closed' | 'open' | 'half_open'; openUntil: string | null };
  /** How its price is read now, when a selector is saved. */
  recipe: { selector: string; attribute: string | null; source: string; since: string } | null;
  /** This workspace's checks of it in the last 24 hours. */
  lastDay: { checks: number; good: number; medianMs: number | null };
}

/** A check in the workspace-wide log: which product it was, too. */
export interface CheckFeedItem extends CheckSummary {
  watchId: string;
  label: string;
}

export interface CheckFeed {
  checks: CheckFeedItem[];
  /** Pass as `before` for the next, older page; null when there are no more. */
  next: string | null;
}
