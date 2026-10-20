import { describe, expect, it } from 'vitest';
import { formatMoney, minorDigits } from './money.ts';

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
