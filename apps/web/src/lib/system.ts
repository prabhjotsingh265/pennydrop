/** Where a check stopped, for the lanes: fetch, extract, or all the way to save. */
export type Stage = 'fetch' | 'extract' | 'save';

/** Outcomes where the page came back but no price was taken from it. */
const AT_EXTRACT = new Set(['price_not_found', 'gone']);

export function stageOf(check: { read: boolean; outcome: string }): Stage {
  if (check.read) return 'save';
  return AT_EXTRACT.has(check.outcome) ? 'extract' : 'fetch';
}

/** "on time", "3 min behind", "2 h behind": how late the oldest due product is. */
export function lagWords(ms: number): string {
  if (ms < 60_000) return 'on time';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min behind`;
  return `${Math.round(ms / 3_600_000)} h behind`;
}

/** 1,284 / 12.9K / 4.2M: big numbers short enough for a tile. */
export function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-GB');
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
