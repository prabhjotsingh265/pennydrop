import { describe, expect, it } from 'vitest';
import { gapFor, nextDue, retryDelay, steadyOffset, stretch } from './schedule.ts';

const HOUR = 3_600_000;

describe('steady offsets', () => {
  it('spreads ten thousand hourly products evenly across the hour', () => {
    const buckets = new Array(12).fill(0);
    for (let i = 0; i < 10_000; i++) {
      buckets[Math.floor(steadyOffset(`target-${i}`, HOUR) / (HOUR / 12))]++;
    }
    // About 833 per five minutes; none of the twelve strays more than 10% from that.
    for (const count of buckets) expect(Math.abs(count - 10_000 / 12)).toBeLessThan(84);
  });

  it('keeps each product’s place', () => {
    expect(steadyOffset('abc', HOUR)).toBe(steadyOffset('abc', HOUR));
  });
});

describe('nextDue', () => {
  it('is always after now, on the product’s own grid, one interval apart', () => {
    const now = Date.UTC(2026, 9, 21, 9, 30);
    const first = nextDue('mug', HOUR, now);
    expect(first).toBeGreaterThan(now);
    expect(first - now).toBeLessThanOrEqual(HOUR);
    expect((first - steadyOffset('mug', HOUR)) % HOUR).toBe(0);
    expect(nextDue('mug', HOUR, first)).toBe(first + HOUR);
  });
});

describe('politeness', () => {
  it('waits the longer of our gap and the site’s crawl delay', () => {
    expect(gapFor({ minGapMs: 10_000, crawlDelay: null })).toBe(10_000);
    expect(gapFor({ minGapMs: 10_000, crawlDelay: 30 })).toBe(30_000);
  });

  it('stretches intervals only when a site’s products want more than its pace allows', () => {
    const site = { minGapMs: 10_000, crawlDelay: null }; // 360 checks an hour
    expect(stretch(site, 100)).toBe(1);
    expect(stretch(site, 720)).toBe(2);
  });
});

describe('retryDelay', () => {
  it('tries again after about 1, 4 and 15 minutes, then leaves it to the schedule', () => {
    expect(retryDelay(1, () => 0.5)).toBe(60_000);
    expect(retryDelay(2, () => 0.5)).toBe(240_000);
    expect(retryDelay(3, () => 0.5)).toBe(900_000);
    expect(retryDelay(4)).toBeNull();
    expect(retryDelay(1, () => 0)).toBe(48_000);
    expect(retryDelay(1, () => 1)).toBe(72_000);
  });
});
