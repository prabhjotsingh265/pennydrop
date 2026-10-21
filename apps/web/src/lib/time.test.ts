import { describe, expect, it } from 'vitest';
import { ago, dateWords, every, safeNext, targetStep } from './time.ts';

describe('time words', () => {
  it.each([
    [20_000, 'just now'],
    [4 * 60_000, '4 min ago'],
    [3 * 3_600_000 + 5, '3 h ago'],
    [50 * 3_600_000, '2 d ago'],
  ])('%i ms reads as %s', (ms, words) => expect(ago(ms)).toBe(words));

  it.each([
    [900, 'every 15 min'],
    [3_600, 'hourly'],
    [21_600, 'every 6 h'],
    [86_400, 'daily'],
  ])('%i s reads as %s', (seconds, words) => expect(every(seconds)).toBe(words));
});

describe('safeNext', () => {
  it('keeps paths on this site and drops everything else', () => {
    expect(safeNext('/app/p/1')).toBe('/app/p/1');
    expect(safeNext('//evil.example.com')).toBe('/app');
    expect(safeNext('https://evil.example.com')).toBe('/app');
    expect(safeNext(null)).toBe('/app');
  });
});

describe('dates and steps', () => {
  it('writes dates in the workspace’s time zone', () => {
    const at = Date.UTC(2026, 9, 21, 22, 30);
    expect(dateWords('Europe/London').moment(at)).toBe('21 Oct, 23:30');
    expect(dateWords('Asia/Kolkata').day(at)).toBe('22 Oct');
    expect(dateWords('Asia/Kolkata').time(at)).toBe('04:00');
  });

  it('drags targets in steps that suit the price', () => {
    expect(targetStep(2_000)).toBe(50);
    expect(targetStep(40_000)).toBe(100);
    expect(targetStep(200_000)).toBe(1_000);
  });
});
