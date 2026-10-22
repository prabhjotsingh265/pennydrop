import type { WatchSummary } from '@pennydrop/domain';
import { scaleTime } from 'd3-scale';

const DAY = 86_400_000;

export const RANGES = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
] as const;
export type RangeKey = (typeof RANGES)[number]['key'];

type History = WatchSummary['history'];

/** The window a range shows, ending now. "All" starts at the first reading (or a day back). */
export function rangeDomain(range: RangeKey, history: History, now: number): [number, number] {
  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  if (days !== null) return [now - days * DAY, now];
  const first = history[0] ? Date.parse(history[0].t) : now - DAY;
  return [Math.min(first, now - DAY), now];
}

/** Change points with a price, as the chart draws them: each holds until the next. */
export function stepPoints(history: History): { t: number; price: number }[] {
  return history.flatMap((p) => (p.price === null ? [] : [{ t: Date.parse(p.t), price: p.price }]));
}

/**
 * Where live readings begin, when history before them was replayed: the
 * chart draws everything earlier lighter. Null when nothing was replayed;
 * infinity while every reading so far is replayed.
 */
export function liveFrom(history: History): number | null {
  if (!history.some((p) => p.replayed)) return null;
  const live = history.find((p) => !p.replayed);
  return live ? Date.parse(live.t) : Number.POSITIVE_INFINITY;
}

/** Stretches when the product was out of stock: hatched on the chart, never just a colour. */
export function soldOutBands(history: History, now: number): { from: number; to: number }[] {
  const bands: { from: number; to: number }[] = [];
  history.forEach((point, i) => {
    if (point.inStock) return;
    const next = history[i + 1];
    const from = Date.parse(point.t);
    const to = next ? Date.parse(next.t) : now;
    const last = bands.at(-1);
    if (last && last.to === from) last.to = to;
    else bands.push({ from, to });
  });
  return bands;
}

/** About five dated ticks along the time axis. */
export function timeTicks([from, to]: [number, number]): number[] {
  return scaleTime()
    .domain([from, to])
    .ticks(5)
    .map((date) => date.getTime());
}

/** The lowest and highest prices seen in a window, counting the one already in force at its start. */
export function extremes(points: { t: number; price: number }[], [from, to]: [number, number]) {
  let inForce: number | null = null;
  const seen: number[] = [];
  for (const point of points) {
    if (point.t <= from) inForce = point.price;
    else if (point.t <= to) seen.push(point.price);
  }
  if (inForce !== null) seen.push(inForce);
  return seen.length ? { low: Math.min(...seen), high: Math.max(...seen) } : null;
}

/** A young product's history fills the chart; an older one opens on its last 30 days. */
export function defaultRange(history: History, now: number): RangeKey {
  const first = history[0] ? Date.parse(history[0].t) : now;
  return now - first < 7 * DAY ? 'all' : '30d';
}

/**
 * A card's window: the last 30 days, or the whole of a younger product's life
 * (at least an hour), with a little room before its first reading.
 */
export function sparkDomain(points: readonly { t: number }[], now: number): [number, number] {
  const month = now - 30 * DAY;
  const first = points[0]?.t;
  if (first === undefined || first <= month) return [month, now];
  const span = Math.max(now - first, 3_600_000);
  return [now - span * 1.05, now];
}

/** Tick labels this close together would run into each other: drop the ones in between. */
export function spacedTicks(
  ticks: readonly number[],
  x: (t: number) => number,
  minGap = 70,
): number[] {
  const kept: number[] = [];
  for (const t of ticks) {
    const last = kept.at(-1);
    if (last === undefined || x(t) - x(last) >= minGap) kept.push(t);
  }
  return kept;
}

export interface HistoryStats {
  lowest: number;
  highest: number;
  /** The lowest in the last 30 days, counting the price already in force then. */
  low30: number | null;
  /** Weighted by how long each price held, so a price that lasted a week counts for a week. */
  average: number;
  /** How many times the price moved. */
  changes: number;
}

/** The product's numbers over all the history there is. Null before any price was read. */
export function historyStats(history: History, now: number): HistoryStats | null {
  const points = stepPoints(history);
  if (!points.length) return null;
  let weighted = 0;
  let span = 0;
  let changes = 0;
  points.forEach((point, i) => {
    const until = points[i + 1]?.t ?? now;
    const held = Math.max(until - point.t, 0);
    weighted += point.price * held;
    span += held;
    if (i > 0 && point.price !== points[i - 1]!.price) changes++;
  });
  const prices = points.map((p) => p.price);
  return {
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    low30: extremes(points, [now - 30 * DAY, now])?.low ?? null,
    average: Math.round(span ? weighted / span : prices[0]!),
    changes,
  };
}
