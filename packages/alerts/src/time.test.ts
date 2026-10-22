import { describe, expect, it } from 'vitest';
import { inWindow, localMinutes, nextLocalTime } from './time.ts';

const iso = (ms: number) => new Date(ms).toISOString();

describe('quiet hours', () => {
  it('reads the clock in the workspace’s zone', () => {
    expect(localMinutes(Date.UTC(2026, 9, 22, 18, 0), 'Asia/Kolkata')).toBe(23 * 60 + 30);
  });

  it('runs past midnight when it starts late', () => {
    const quiet = (utcHour: number, zone: string) =>
      inWindow(Date.UTC(2026, 9, 22, utcHour), zone, 22 * 60, 7 * 60);
    expect(quiet(17, 'Asia/Kolkata')).toBe(true); // 22:30 in Kolkata
    expect(quiet(1, 'Asia/Kolkata')).toBe(true); // 06:30
    expect(quiet(2, 'Asia/Kolkata')).toBe(false); // 07:30
    expect(inWindow(Date.UTC(2026, 9, 22, 12), 'Europe/London', 9 * 60, 17 * 60)).toBe(true);
    expect(inWindow(Date.UTC(2026, 9, 22, 12), 'Europe/London', 600, 600)).toBe(false);
  });
});

describe('nextLocalTime', () => {
  it('finds the next 07:00 in Kolkata, today or tomorrow', () => {
    // 18:00 UTC is 23:30 in Kolkata: the next 07:00 there is 01:30 UTC tomorrow.
    expect(iso(nextLocalTime(Date.UTC(2026, 9, 22, 18), 'Asia/Kolkata', 7 * 60))).toBe(
      '2026-10-23T01:30:00.000Z',
    );
    // 00:00 UTC is 05:30 there: 07:00 is later the same day.
    expect(iso(nextLocalTime(Date.UTC(2026, 9, 22, 0), 'Asia/Kolkata', 7 * 60))).toBe(
      '2026-10-22T01:30:00.000Z',
    );
  });

  it('stays right across a clock change', () => {
    // London leaves summer time at 02:00 on 25 October 2026: 08:00 that morning is 08:00 UTC.
    expect(iso(nextLocalTime(Date.UTC(2026, 9, 24, 20), 'Europe/London', 8 * 60))).toBe(
      '2026-10-25T08:00:00.000Z',
    );
    // The day before, still summer time: 08:00 is 07:00 UTC.
    expect(iso(nextLocalTime(Date.UTC(2026, 9, 23, 20), 'Europe/London', 8 * 60))).toBe(
      '2026-10-24T07:00:00.000Z',
    );
  });

  it('is always after the moment it was asked', () => {
    const at = Date.UTC(2026, 9, 22, 7, 0); // exactly 08:00 in London
    expect(nextLocalTime(at, 'Europe/London', 8 * 60)).toBeGreaterThan(at);
  });
});
