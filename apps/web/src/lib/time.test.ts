import { describe, expect, it } from 'vitest';
import { ago, every, safeNext } from './time.ts';

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
