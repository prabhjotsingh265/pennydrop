import { describe, expect, it } from 'vitest';
import {
  defaultRange,
  historyStats,
  spacedTicks,
  sparkDomain,
  extremes,
  rangeDomain,
  soldOutBands,
  stepPoints,
  timeTicks,
} from './chart.ts';

const NOW = Date.UTC(2026, 9, 21, 12);
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const history = [
  { t: at(40), price: 4000, inStock: true },
  { t: at(20), price: 3600, inStock: true },
  { t: at(10), price: 3600, inStock: false },
  { t: at(8), price: null, inStock: false },
  { t: at(5), price: 3400, inStock: true },
];

describe('the product chart', () => {
  it('shows a window ending now, or everything since the first reading', () => {
    expect(rangeDomain('7d', history, NOW)).toEqual([NOW - 7 * DAY, NOW]);
    expect(rangeDomain('all', history, NOW)).toEqual([NOW - 40 * DAY, NOW]);
    expect(rangeDomain('all', [], NOW)).toEqual([NOW - DAY, NOW]);
  });

  it('draws only readings with a price', () => {
    expect(stepPoints(history).map((p) => p.price)).toEqual([4000, 3600, 3600, 3400]);
  });

  it('joins neighbouring sold-out stretches into one band', () => {
    expect(soldOutBands(history, NOW)).toEqual([{ from: NOW - 10 * DAY, to: NOW - 5 * DAY }]);
    expect(soldOutBands([{ t: at(1), price: 10, inStock: false }], NOW)).toEqual([
      { from: NOW - DAY, to: NOW },
    ]);
  });

  it('counts the price already in force at the window’s start', () => {
    const points = stepPoints(history);
    expect(extremes(points, [NOW - 7 * DAY, NOW])).toEqual({ low: 3400, high: 3600 });
    expect(extremes([], [NOW - 7 * DAY, NOW])).toBeNull();
  });

  it('puts a handful of dated ticks on the time axis', () => {
    const ticks = timeTicks([NOW - 30 * DAY, NOW]);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.every((t) => t >= NOW - 30 * DAY && t <= NOW)).toBe(true);
  });
});

describe('defaultRange', () => {
  it('shows all of a young product’s history, and the last 30 days of an older one', () => {
    expect(defaultRange([{ t: at(0.3), price: 1, inStock: true }], NOW)).toBe('all');
    expect(defaultRange([], NOW)).toBe('all');
    expect(defaultRange(history, NOW)).toBe('30d');
  });
});

describe('sparkDomain', () => {
  it('shows a young product’s whole life, and an older one’s last 30 days', () => {
    const [from, to] = sparkDomain([{ t: NOW - 10 * 3_600_000 }], NOW);
    expect(to).toBe(NOW);
    expect(from).toBeCloseTo(NOW - 10.5 * 3_600_000, -3);
    expect(sparkDomain([{ t: NOW - 40 * DAY }], NOW)).toEqual([NOW - 30 * DAY, NOW]);
    expect(sparkDomain([], NOW)).toEqual([NOW - 30 * DAY, NOW]);
    // Read a moment ago: still an hour wide, so the line has room.
    expect(NOW - sparkDomain([{ t: NOW - 1_000 }], NOW)[0]).toBeGreaterThan(3_600_000);
  });
});

describe('spacedTicks', () => {
  it('keeps tick labels far enough apart to read', () => {
    const x = (t: number) => t * 30;
    expect(spacedTicks([0, 1, 2, 3, 4, 5], x)).toEqual([0, 3]);
    expect(spacedTicks([0, 3, 6], x)).toEqual([0, 3, 6]);
  });
});

describe('historyStats', () => {
  it('sums up the whole history, weighting the average by how long each price held', () => {
    // 4000 for 20 days, 3600 for 10 days (then out of stock, still 3600), 3400 for the last 5.
    expect(historyStats(history, NOW)).toEqual({
      lowest: 3400,
      highest: 4000,
      low30: 3400,
      average: Math.round((4000 * 20 + 3600 * 10 + 3600 * 5 + 3400 * 5) / 40),
      changes: 2,
    });
  });

  it('has nothing to say before a price was read', () => {
    expect(historyStats([], NOW)).toBeNull();
  });
});
