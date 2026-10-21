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
