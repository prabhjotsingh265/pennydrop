import type { WatchSummary } from '@pennydrop/domain';
import { describe, expect, it } from 'vitest';
import {
  cheapest,
  compareDomain,
  defaultCompareDays,
  seriesFor,
  SHOP_COLOURS,
  undercut,
} from './compare.ts';

const watch = (
  host: string,
  price: number | null,
  extra: Partial<WatchSummary> = {},
): WatchSummary => ({
  id: host,
  targetId: host,
  label: 'Kettle',
  url: `https://${host}/p/kettle`,
  host,
  currency: 'GBP',
  price,
  targetPrice: null,
  inStock: true,
  status: 'active',
  paused: false,
  isMine: false,
  groupId: 'g',
  intervalSeconds: 3_600,
  lastCheckedAt: null,
  lastSuccessAt: null,
  history: [],
  ...extra,
});

describe('seriesFor', () => {
  it('gives each shop its colour by order, your own listing ink, and folds the rest away', () => {
    const shops = ['a', 'b', 'c', 'd', 'e', 'f'].map((h) => watch(`${h}.example.com`, 100));
    const series = seriesFor([watch('mine.example.com', 90, { isMine: true }), ...shops], 'light');
    expect(series[0]).toMatchObject({ name: 'You', colour: 'var(--ink)', mine: true });
    expect(series.slice(1, 6).map((s) => s.colour)).toEqual([...SHOP_COLOURS.light]);
    expect(series[6]).toMatchObject({ name: 'f.example.com', other: true });
  });
});

describe('cheapest', () => {
  it('finds the cheapest in the main currency, and says when some weren’t compared', () => {
    const group = [
      watch('a.example.com', 5_000),
      watch('b.example.com', 4_500),
      watch('c.example.com', 3_000, { currency: 'EUR' }),
      watch('d.example.com', 1_000, { paused: true }),
      watch('e.example.com', null),
    ];
    expect(cheapest(group)).toEqual({
      watchId: 'b.example.com',
      price: 4_500,
      currency: 'GBP',
      mixed: true,
    });
    expect(cheapest([watch('a.example.com', null)])).toBeNull();
  });
});

describe('undercut', () => {
  it('names the cheapest rival below your own listing', () => {
    const group = [
      watch('mine.example.com', 5_000, { isMine: true }),
      watch('a.example.com', 4_800),
      watch('b.example.com', 4_500),
      watch('c.example.com', 5_500),
    ];
    expect(undercut(group)).toMatchObject({ rival: { host: 'b.example.com' }, by: 500 });
    expect(undercut(group.slice(0, 1))).toBeNull();
  });
});

describe('the compare window', () => {
  const NOW = Date.UTC(2026, 9, 22, 12);
  const young = seriesFor(
    [
      watch('a.example.com', 100, {
        history: [{ t: new Date(NOW - 20 * 3_600_000).toISOString(), price: 100, inStock: true }],
      }),
    ],
    'light',
  );
  it('fits a young group’s readings, and opens on them', () => {
    const [from, to] = compareDomain(young, null, NOW);
    expect(to).toBe(NOW);
    expect(NOW - from).toBeCloseTo(21 * 3_600_000, -3);
    expect(defaultCompareDays(young, NOW)).toBeNull();
  });
  it('shows a fixed window when asked', () => {
    expect(compareDomain(young, 7, NOW)).toEqual([NOW - 7 * 86_400_000, NOW]);
  });
});
