import { describe, expect, it } from 'vitest';
import { discountCheck, type DiscountPoint } from './discount.ts';

const DAY = 86_400_000;
const SALE = Date.UTC(2026, 9, 23, 9, 0);

/** A price first seen some days before the sale (negative: after it began). */
const at = (daysBefore: number, price: number, was: number | null = null): DiscountPoint => ({
  firstSeenAt: new Date(SALE - daysBefore * DAY),
  price: BigInt(price),
  wasPrice: was === null ? null : BigInt(was),
  currency: 'GBP',
});

describe('discountCheck', () => {
  it('has nothing to say without a "was" price', () => {
    expect(discountCheck([])).toBeNull();
    expect(discountCheck([at(40, 2599), at(0, 1899)])).toBeNull();
  });

  it('calls a "was" price honest when it was the lowest of the 30 days before', () => {
    const check = discountCheck([at(60, 2599), at(20, 2699), at(0, 1899, 2599)]);
    expect(check).toMatchObject({
      was: 2599,
      price: 1899,
      lowestBefore: 2599,
      days: 30,
      verdict: 'honest',
      since: new Date(SALE).toISOString(),
      // £25.99 was already showing when the 30 days began.
      lowestAt: new Date(SALE - 30 * DAY).toISOString(),
    });
  });

  it('catches a price put up just before the sale', () => {
    // £21.99 for weeks, £26.39 from Monday, then "was £26.39, now £18.99" on Friday.
    const check = discountCheck([at(45, 2199), at(4, 2639), at(0, 1899, 2639)]);
    expect(check).toMatchObject({ was: 2639, lowestBefore: 2199, verdict: 'inflated' });
    expect(check!.lowestAt).toBe(new Date(SALE - 30 * DAY).toISOString());
  });

  it('can prove inflation before 30 days of history, but not honesty', () => {
    expect(discountCheck([at(10, 2199), at(0, 1899, 2599)])).toMatchObject({
      days: 10,
      verdict: 'inflated',
    });
    expect(discountCheck([at(10, 2599), at(0, 1899, 2599)])).toMatchObject({
      days: 10,
      verdict: 'too_soon',
    });
    // A product first seen already on sale: nothing to compare with.
    expect(discountCheck([at(0, 1899, 2599)])).toMatchObject({
      lowestBefore: null,
      days: 0,
      verdict: 'too_soon',
    });
  });

  it('dates the sale from when a "was" price first showed, even if it moves', () => {
    const check = discountCheck([at(40, 2599), at(3, 1999, 2599), at(1, 1899, 2499)]);
    expect(check).toMatchObject({ was: 2499, since: new Date(SALE - 3 * DAY).toISOString() });
    // Against the £25.99 charged before the sale, a "was" of £24.99 understates it: honest.
    expect(check!.verdict).toBe('honest');
  });

  it('ignores prices older than the 30 days, and out-of-stock gaps with no price', () => {
    const check = discountCheck([
      at(90, 1599),
      at(40, 2599),
      { ...at(10, 0), price: null },
      at(5, 2599),
      at(0, 1899, 2599),
    ]);
    expect(check).toMatchObject({ lowestBefore: 2599, verdict: 'honest' });
  });
});
