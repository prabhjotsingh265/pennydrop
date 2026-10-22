import type { DiscountCheck } from '@pennydrop/domain';

const DAY = 86_400_000;
/** The EU's rule: a sale's "was" price is the lowest of the 30 days before it. */
export const DISCOUNT_WINDOW_DAYS = 30;

export interface DiscountPoint {
  firstSeenAt: Date;
  price: bigint | null;
  wasPrice: bigint | null;
  currency: string;
}

/**
 * Checks the "was" price a shop shows now against what we saw it charge in
 * the 30 days before the sale began. Points are oldest first. Null when
 * there's no "was" price to check.
 */
export function discountCheck(points: readonly DiscountPoint[]): DiscountCheck | null {
  const current = points.at(-1);
  if (!current || current.price === null || current.wasPrice === null) return null;

  // The sale began where the shop started showing a "was" price (which may move during it).
  let start = points.length - 1;
  while (
    start > 0 &&
    points[start - 1]!.wasPrice !== null &&
    points[start - 1]!.currency === current.currency
  ) {
    start--;
  }
  const since = points[start]!.firstSeenAt.getTime();
  const from = since - DISCOUNT_WINDOW_DAYS * DAY;

  // Every price in force during those 30 days: the one already showing when they began, and each after.
  const before = points.slice(0, start).filter((p) => p.currency === current.currency);
  const atStart = before.filter((p) => p.firstSeenAt.getTime() <= from).at(-1);
  const during = [
    ...(atStart ? [atStart] : []),
    ...before.filter((p) => p.firstSeenAt.getTime() > from),
  ];
  let lowest: DiscountPoint | null = null;
  for (const point of during) {
    if (point.price !== null && (lowest === null || point.price < lowest.price!)) lowest = point;
  }

  const was = Number(current.wasPrice);
  const lowestBefore = lowest === null ? null : Number(lowest.price);
  const watchedSince = before[0]?.firstSeenAt.getTime() ?? since;
  const days = Math.min(DISCOUNT_WINDOW_DAYS, Math.floor((since - watchedSince) / DAY));
  const verdict =
    lowestBefore !== null && lowestBefore < was
      ? 'inflated'
      : lowestBefore !== null && days >= DISCOUNT_WINDOW_DAYS
        ? 'honest'
        : 'too_soon';

  return {
    was,
    price: Number(current.price),
    currency: current.currency,
    since: new Date(since).toISOString(),
    lowestBefore,
    // A price already showing when the 30 days began counts from their start.
    lowestAt: lowest ? new Date(Math.max(lowest.firstSeenAt.getTime(), from)).toISOString() : null,
    days,
    verdict,
  };
}
