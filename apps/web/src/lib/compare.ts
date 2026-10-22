import type { WatchSummary } from '@pennydrop/domain';
import { stepPoints } from './chart.ts';
import type { Theme } from './tint.ts';

/** Checked with a colour-blindness validator (design system, section 20): one per shop, in order. */
export const SHOP_COLOURS: Record<Theme, readonly string[]> = {
  light: ['#2A78D6', '#1BAF7A', '#6250D6', '#E87BA4', '#EDA100'],
  dark: ['#3987E5', '#199E70', '#9085E9', '#D55181', '#C98500'],
};

export interface Series {
  watch: WatchSummary;
  /** "You" for your own listing, otherwise the shop. */
  name: string;
  colour: string;
  mine: boolean;
  /** Beyond the five named shops: drawn faintly, as "Other shops". */
  other: boolean;
  points: { t: number; price: number }[];
}

/**
 * One line per shop. Colours go by the order shops joined, so a shop keeps
 * its colour when others come and go; your own listing is drawn in ink.
 */
export function seriesFor(watches: readonly WatchSummary[], theme: Theme): Series[] {
  const palette = SHOP_COLOURS[theme];
  let shop = 0;
  return watches.map((watch) => {
    if (watch.isMine) {
      return {
        watch,
        name: 'You',
        colour: 'var(--ink)',
        mine: true,
        other: false,
        points: stepPoints(watch.history),
      };
    }
    const index = shop++;
    const other = index >= palette.length;
    return {
      watch,
      name: watch.host,
      colour: other ? 'var(--ink-2)' : palette[index]!,
      mine: false,
      other,
      points: stepPoints(watch.history),
    };
  });
}

/** The currency most of the group's prices are in: only those are compared. */
function mainCurrency(watches: readonly WatchSummary[]): string | null {
  const counts = new Map<string, number>();
  for (const w of watches)
    if (w.price !== null && w.currency) counts.set(w.currency, (counts.get(w.currency) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export interface Cheapest {
  watchId: string;
  price: number;
  currency: string;
  /** Some prices are in another currency and weren't compared. */
  mixed: boolean;
}

export function cheapest(watches: readonly WatchSummary[]): Cheapest | null {
  const currency = mainCurrency(watches);
  if (!currency) return null;
  const priced = watches.filter((w) => w.price !== null && !w.paused);
  const comparable = priced.filter((w) => w.currency === currency);
  const best = [...comparable].sort((a, b) => a.price! - b.price!)[0];
  return best
    ? { watchId: best.id, price: best.price!, currency, mixed: comparable.length < priced.length }
    : null;
}

/** A competitor now cheaper than your own listing, and by how much. */
export function undercut(watches: readonly WatchSummary[]) {
  const mine = watches.find((w) => w.isMine && w.price !== null);
  if (!mine) return null;
  const rival = watches
    .filter(
      (w) => !w.isMine && w.price !== null && w.currency === mine.currency && w.price < mine.price!,
    )
    .sort((a, b) => a.price! - b.price!)[0];
  return rival ? { rival, by: mine.price! - rival.price!, currency: mine.currency ?? 'GBP' } : null;
}

const DAY = 86_400_000;

/**
 * The window to compare in: a fixed number of days, or "all", which fits the
 * readings there are (at least an hour) so a young group isn't squeezed into
 * the edge of a month.
 */
export function compareDomain(
  series: readonly Series[],
  days: number | null,
  now: number,
): [number, number] {
  if (days !== null) return [now - days * DAY, now];
  const first = Math.min(...series.flatMap((s) => (s.points[0] ? [s.points[0].t] : [])));
  if (!Number.isFinite(first)) return [now - DAY, now];
  const span = Math.max(now - first, 3_600_000);
  return [now - span * 1.05, now];
}

/** A group whose history is younger than a week opens on all of it. */
export function defaultCompareDays(series: readonly Series[], now: number): number | null {
  const first = Math.min(...series.flatMap((s) => (s.points[0] ? [s.points[0].t] : [])));
  return Number.isFinite(first) && now - first < 7 * DAY ? null : 30;
}
