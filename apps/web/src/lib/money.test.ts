import { describe, expect, it } from 'vitest';
import { axisFormatter, formatMoney, minorDigits } from './money.ts';

describe('money', () => {
  it('knows how many minor units each currency has', () => {
    expect(minorDigits('GBP')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
  });

  it('formats whole minor units', () => {
    expect(formatMoney(4650)).toBe('£46.50');
    expect(formatMoney(1299, 'JPY')).toBe('JP¥1,299');
    expect(formatMoney(12999900, 'INR', 'en-IN')).toBe('₹1,29,999.00');
  });
});

describe('axisFormatter', () => {
  it('shows whole units unless the ticks are closer than one', () => {
    expect([6400, 6500, 6600].map(axisFormatter('GBP', [6400, 6500, 6600]))).toEqual([
      '£64',
      '£65',
      '£66',
    ]);
    expect([6450, 6500, 6550].map(axisFormatter('GBP', [6450, 6500, 6550]))).toEqual([
      '£64.50',
      '£65.00',
      '£65.50',
    ]);
    // Yen has no minor units: 1,299 is ¥1,299, not ¥12.99.
    expect(axisFormatter('JPY', [1200, 1300])(1299)).toBe('JP¥1,299');
  });
});
