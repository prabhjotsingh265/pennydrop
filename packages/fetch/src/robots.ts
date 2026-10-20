import robotsParser from 'robots-parser';

/** How the last fetch of a site's robots.txt went. */
export type RobotsStatus = 'ok' | 'missing' | 'unreachable';

export interface RobotsRecord {
  status: RobotsStatus;
  /** The file as served, cut to the first 500 KiB. */
  body: string;
  fetchedAt: number;
}

export interface RobotsVerdict {
  allowed: boolean;
  /** Seconds to wait between requests, if the site asks. */
  crawlDelay: number | null;
  reason: string;
}

/** RFC 9309: robots.txt may be cached for up to a day. */
export const ROBOTS_TTL = 24 * 3_600_000;
/** RFC 9309: crawlers must parse at least the first 500 KiB. */
export const ROBOTS_LIMIT = 500 * 1024;

export function robotsUrl(pageUrl: string): string {
  return new URL('/robots.txt', pageUrl).toString();
}

/** Turns how the fetch went into a record, following RFC 9309's rules for each status. */
export function robotsRecord(
  httpStatus: number | null,
  body: string,
  fetchedAt: number,
): RobotsRecord {
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
    return { status: 'ok', body: body.slice(0, ROBOTS_LIMIT), fetchedAt };
  }
  // 4xx: there are no rules, so everything is allowed. 5xx or no answer: assume nothing is.
  if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
    return { status: 'missing', body: '', fetchedAt };
  }
  return { status: 'unreachable', body: '', fetchedAt };
}

export function isFresh(record: RobotsRecord, now: number): boolean {
  return now - record.fetchedAt < ROBOTS_TTL;
}

/** May this user agent fetch this page, and how slowly? */
export function robotsVerdict(
  record: RobotsRecord,
  pageUrl: string,
  userAgent: string,
): RobotsVerdict {
  if (record.status === 'missing') {
    return {
      allowed: true,
      crawlDelay: null,
      reason: 'The site has no robots.txt, so every page is allowed.',
    };
  }
  if (record.status === 'unreachable') {
    return {
      allowed: false,
      crawlDelay: null,
      reason: 'The site’s robots.txt could not be read, so no page is allowed until it can.',
    };
  }
  const robots = robotsParser(robotsUrl(pageUrl), record.body);
  const allowed = robots.isAllowed(pageUrl, userAgent) !== false;
  const delay = robots.getCrawlDelay(userAgent);
  return {
    allowed,
    crawlDelay: delay === undefined ? null : delay,
    reason: allowed
      ? 'robots.txt allows this page.'
      : 'The shop’s robots.txt asks robots not to visit this page.',
  };
}
