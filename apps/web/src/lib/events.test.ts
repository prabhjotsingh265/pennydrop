import { describe, expect, it } from 'vitest';
import { chartFlag, eventWords, isGoodOutcome, outcomeWords } from './events.ts';

describe('events in words', () => {
  it('says what happened, plainly', () => {
    expect(eventWords({ kind: 'layout_changed', details: {} })).toBe(
      'The shop changed its page layout.',
    );
    expect(eventWords({ kind: 'something_new', details: {} })).toBe('something new');
  });

  it('flags only the events that explain the line', () => {
    expect(chartFlag('layout_changed')).toBe('Redesign');
    expect(chartFlag('breaker_closed')).toBeNull();
  });
});

describe('check outcomes in words', () => {
  it('names each outcome, and which ones read the page', () => {
    expect(outcomeWords('robots_disallowed')).toBe('Ruled out by robots.txt');
    expect(outcomeWords('brand_new')).toBe('brand new');
    expect(isGoodOutcome('unchanged')).toBe(true);
    expect(isGoodOutcome('timeout')).toBe(false);
  });
});
