import { BREAK_ACTIONS } from '@pennydrop/domain';
import { describe, expect, it } from 'vitest';
import { BREAKS, endsWords } from './demo.ts';

describe('endsWords', () => {
  it('says how long a demo has left', () => {
    const now = Date.UTC(2026, 9, 22, 12);
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(endsWords(at(23.6 * 3_600_000), now)).toBe('ends in 24 h');
    expect(endsWords(at(40 * 60_000), now)).toBe('ends in 40 min');
    expect(endsWords(at(10_000), now)).toBe('ends in 1 min');
    expect(endsWords(at(-1), now)).toBe('has ended');
  });
});

describe('BREAKS', () => {
  it('has a button for everything but "fix", which is its own', () => {
    expect(BREAKS.map((b) => b.action).sort()).toEqual(
      BREAK_ACTIONS.filter((a) => a !== 'fix').sort(),
    );
  });
});
