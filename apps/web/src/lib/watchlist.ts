import type { WatchSummary } from '@pennydrop/domain';
import { distanceFromTarget } from './tint.ts';

/** How far above its target a product is, as a fraction of the target. Null without both. */
export function distance(watch: WatchSummary): number | null {
  return watch.price !== null && watch.targetPrice !== null
    ? distanceFromTarget(watch.price, watch.targetPrice)
    : null;
}

export const reached = (watch: WatchSummary) =>
  watch.price !== null && watch.targetPrice !== null && watch.price <= watch.targetPrice;

/** Closest to its target first; then those without a target or a price yet, by name. */
export function byCloseness(a: WatchSummary, b: WatchSummary): number {
  const da = distance(a);
  const db = distance(b);
  if (da !== null && db !== null) return da - db || a.label.localeCompare(b.label);
  if (da !== null) return -1;
  if (db !== null) return 1;
  return a.label.localeCompare(b.label);
}

/** Why a product isn't being read as usual, short enough for a chip. Null when all is well. */
export function trouble(watch: WatchSummary): string | null {
  switch (watch.status) {
    case 'paused':
      return 'Paused';
    case 'gone':
      return 'Page gone';
    case 'blocked':
      return 'Blocked';
    case 'needs_attention':
      return 'Needs attention';
    default:
      return null;
  }
}

/** What the card shows in place of a price before one has been read. */
export function waiting(watch: WatchSummary): string {
  return watch.lastCheckedAt ? 'No price read yet' : 'First check on its way';
}
