import type { WatchSummary } from '@pennydrop/domain';
import { describe, expect, it } from 'vitest';
import { byCloseness, distanceWords, reached, trouble, waiting } from './watchlist.ts';

const watch = (label: string, price: number | null, targetPrice: number | null): WatchSummary => ({
  id: label,
  targetId: label,
  label,
  url: `https://shop.example.com/p/${label}`,
  host: 'shop.example.com',
  currency: 'GBP',
  price,
  targetPrice,
  inStock: true,
  status: 'active',
  paused: false,
  isMine: false,
  groupId: null,
  intervalSeconds: 3_600,
  lastCheckedAt: null,
  lastSuccessAt: null,
  history: [],
});

describe('the watchlist order', () => {
  it('puts the closest to target first, then the rest by name', () => {
    const list = [
      watch('zebra lamp', null, null),
      watch('far', 5_000, 3_000),
      watch('apron', 3_000, null),
      watch('under', 2_500, 3_000),
      watch('near', 3_100, 3_000),
    ];
    expect(list.sort(byCloseness).map((w) => w.label)).toEqual([
      'under',
      'near',
      'far',
      'apron',
      'zebra lamp',
    ]);
  });

  it('knows when a target is reached', () => {
    expect(reached(watch('a', 3_000, 3_000))).toBe(true);
    expect(reached(watch('b', 3_001, 3_000))).toBe(false);
    expect(reached(watch('c', null, 3_000))).toBe(false);
  });
});

describe('what a card says', () => {
  it('names the trouble, and what it’s waiting for', () => {
    expect(trouble({ ...watch('a', 1, 1), status: 'needs_attention' })).toBe('Needs attention');
    expect(trouble({ ...watch('a', 1, 1), status: 'blocked' })).toBe('Blocked');
    expect(trouble(watch('a', 1, 1))).toBeNull();
    expect(waiting(watch('a', null, null))).toBe('First check on its way');
    expect(waiting({ ...watch('a', null, null), lastCheckedAt: '2026-10-21T08:00:00Z' })).toBe(
      'No price read yet',
    );
  });
});

describe('distanceWords', () => {
  it('says above, at or under, never "-£0.00 under"', () => {
    expect(distanceWords(320, 'GBP')).toEqual({ text: '£3.20 above', reached: false });
    expect(distanceWords(0, 'GBP')).toEqual({ text: 'at target', reached: true });
    expect(distanceWords(-1, 'GBP')).toEqual({ text: '↓ £0.01 under', reached: true });
    expect(distanceWords(-1, 'GBP', 'your target').text).toBe('↓ £0.01 under your target');
  });
});
