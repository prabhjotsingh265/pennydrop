import type { DiscountCheck } from '@pennydrop/domain';
import { describe, expect, it } from 'vitest';
import { discountWords, percentOff } from './discount.ts';

const day = (t: number) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(t);

const check = (extra: Partial<DiscountCheck>): DiscountCheck => ({
  was: 2639,
  price: 1899,
  currency: 'GBP',
  since: '2026-10-23T09:00:00.000Z',
  lowestBefore: 2199,
  lowestAt: '2026-09-23T09:00:00.000Z',
  days: 30,
  verdict: 'inflated',
  ...extra,
});

describe('discountWords', () => {
  it('works out the real discount against what we saw', () => {
    expect(percentOff(2639, 1899)).toBe(28);
    expect(discountWords(check({}), day)).toEqual({
      title: 'The “was” price is inflated',
      text: 'In the 30 days before the sale began on 23 Oct, we saw it at £21.99 (from 23 Sept). Against that, it’s 14% off, not 28%.',
    });
  });

  it('says when a "sale" is no cheaper at all', () => {
    expect(discountWords(check({ lowestBefore: 1899 }), day).text).toContain(
      'it’s the same price, not 28% off.',
    );
    expect(discountWords(check({ lowestBefore: 1799 }), day).text).toContain(
      'it costs £1.00 more, not 28% less.',
    );
  });

  it('vouches for an honest one', () => {
    expect(discountWords(check({ lowestBefore: 2639, verdict: 'honest' }), day)).toEqual({
      title: 'The discount is real',
      text: 'We never saw it below £26.39 in the 30 days before the sale began on 23 Oct, so “was £26.39” holds up: 28% off.',
    });
  });

  it('won’t guess without 30 days of history', () => {
    expect(
      discountWords(check({ lowestBefore: 2639, days: 9, verdict: 'too_soon' }), day).text,
    ).toBe(
      'We’d watched it for 9 days before the sale began on 23 Oct, not 30. In that time it never went below £26.39.',
    );
    expect(
      discountWords(check({ lowestBefore: 2639, days: 0, verdict: 'too_soon' }), day).text,
    ).toContain('for less than a day');
    expect(
      discountWords(
        check({ lowestBefore: null, lowestAt: null, days: 0, verdict: 'too_soon' }),
        day,
      ).text,
    ).toBe(
      'It was already on sale when we started watching, so we haven’t seen what it cost before.',
    );
  });
});
