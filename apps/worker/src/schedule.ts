const HOUR = 3_600_000;

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A product's steady place within its interval, from a hash of its id. Ten
 * thousand hourly products then fall evenly across the hour instead of all
 * at the top of it, and each keeps its place across restarts.
 */
export function steadyOffset(id: string, intervalMs: number): number {
  return hash(id) % intervalMs;
}

/** The first moment after `now` on the product's steady grid. */
export function nextDue(id: string, intervalMs: number, now: number): number {
  const offset = steadyOffset(id, intervalMs);
  return (Math.floor((now - offset) / intervalMs) + 1) * intervalMs + offset;
}

export interface SitePace {
  minGapMs: number;
  /** Seconds, from robots.txt. */
  crawlDelay: number | null;
}

/** The gap the site actually gets: our minimum, or its crawl delay if that's longer. */
export function gapFor(site: SitePace): number {
  return Math.max(site.minGapMs, (site.crawlDelay ?? 0) * 1000);
}

/**
 * How much to stretch every interval on a site so its products fit its pace.
 * A site that allows one request every 10 s has room for 360 checks an hour;
 * products asking for 720 an hour each get checked half as often.
 */
export function stretch(site: SitePace, checksWantedPerHour: number): number {
  const capacity = HOUR / Math.max(gapFor(site), 1);
  return Math.max(1, checksWantedPerHour / capacity);
}

const RETRIES_MS = [60_000, 240_000, 900_000];

/**
 * After a failure, try again soon, then less soon: 1, 4, then 15 minutes,
 * each give or take a fifth. After three, the normal interval takes over.
 */
export function retryDelay(failures: number, random = Math.random): number | null {
  const base = RETRIES_MS[failures - 1];
  if (base === undefined) return null;
  return Math.round(base * (0.8 + random() * 0.4));
}
