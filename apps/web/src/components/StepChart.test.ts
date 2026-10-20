import { describe, expect, it } from 'vitest';
import { priceAt } from './StepChart.tsx';

const points = [
  { t: 0, price: 4800 },
  { t: 5, price: 4650 },
  { t: 9, price: 4400 },
];

describe('priceAt', () => {
  it('holds each price until the next change', () => {
    expect(priceAt(points, 0)).toBe(4800);
    expect(priceAt(points, 4.9)).toBe(4800);
    expect(priceAt(points, 5)).toBe(4650);
    expect(priceAt(points, 30)).toBe(4400);
  });

  it('uses the first price before history starts', () => {
    expect(priceAt(points, -3)).toBe(4800);
  });
});
