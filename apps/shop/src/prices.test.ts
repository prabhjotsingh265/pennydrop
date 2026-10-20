import { describe, expect, it } from 'vitest';
import { PRODUCTS, findProduct } from './catalogue.ts';
import { DAY, HOUR, OPENED, WEEK, inflatesBeforeSales, quote } from './prices.ts';

const mug = findProduct('stoneware-mug')!;
const at = (days: number) => OPENED + days * DAY;

describe('quote', () => {
  it('gives the same answer for the same moment, whatever was asked before', () => {
    const later = quote(mug, at(200));
    quote(mug, at(10)); // asking about the past replays the walk from the start
    expect(quote(mug, at(200))).toEqual(later);
  });

  it('changes price over time', () => {
    const prices = new Set(Array.from({ length: 60 }, (_, d) => quote(mug, at(d)).price));
    expect(prices.size).toBeGreaterThan(3);
  });

  it('stays within 72% to 118% of the starting price, sales aside', () => {
    for (const product of PRODUCTS) {
      for (let d = 0; d < 300; d += 3) {
        const q = quote(product, at(d), { sale: 'off' });
        expect(q.price).toBeGreaterThanOrEqual(Math.floor(product.base * 0.72 * 0.98));
        expect(q.price).toBeLessThanOrEqual(Math.ceil(product.base * 1.18 * 1.2 * 1.02));
      }
    }
  });

  it('prices like a shop: .99, or in 50p steps', () => {
    for (const product of PRODUCTS) {
      const { price } = quote(product, at(100), { sale: 'off' });
      expect(product.charm ? price % 100 === 99 : price % 50 === 0).toBe(true);
    }
  });

  it('shows a higher "was" price during a sale', () => {
    const q = quote(mug, at(100), { sale: 'on' });
    expect(q.was).not.toBeNull();
    expect(q.price).toBeLessThan(q.was!);
  });

  it('can be forced in or out of stock', () => {
    expect(quote(mug, at(5), { stock: 'out' }).inStock).toBe(false);
    expect(quote(mug, at(5), { stock: 'in' }).inStock).toBe(true);
  });

  it("gives inflaters' sales a 'was' price above the 30-day low", () => {
    // Find a real sale by a product that inflates its price beforehand.
    let found = false;
    for (const product of PRODUCTS.filter(inflatesBeforeSales)) {
      for (let week = 5; week < 40 && !found; week++) {
        const friday = OPENED + week * WEEK + 4 * DAY + 12 * HOUR;
        const sale = quote(product, friday);
        if (sale.was === null) continue;
        let low = Infinity;
        for (let t = friday - 30 * DAY; t < friday - 5 * DAY; t += 6 * HOUR) {
          low = Math.min(low, quote(product, t, { sale: 'off' }).price);
        }
        expect(sale.was).toBeGreaterThan(low);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
