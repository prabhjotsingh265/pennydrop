import { describe, expect, it } from 'vitest';
import { compact, lagWords, stageOf } from './system.ts';

describe('the System page’s words', () => {
  it('parks a check where it stopped', () => {
    expect(stageOf({ read: true, outcome: 'ok' })).toBe('save');
    expect(stageOf({ read: false, outcome: 'price_not_found' })).toBe('extract');
    expect(stageOf({ read: false, outcome: 'timeout' })).toBe('fetch');
    expect(stageOf({ read: false, outcome: 'skipped_breaker_open' })).toBe('fetch');
  });

  it('says how far behind the schedule is', () => {
    expect(lagWords(20_000)).toBe('on time');
    expect(lagWords(3 * 60_000)).toBe('3 min behind');
    expect(lagWords(2 * 3_600_000)).toBe('2 h behind');
  });

  it('shortens big numbers', () => {
    expect(compact(1284)).toBe('1,284');
    expect(compact(12_900)).toBe('12.9K');
    expect(compact(4_200_000)).toBe('4.2M');
  });
});
