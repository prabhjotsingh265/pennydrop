import { describe, expect, it } from 'vitest';
import { nextIndex } from './PriceDigits.tsx';

// Each wheel holds 0–9 three times (indexes 0–29) and rests in the middle copy (10–19).
const digitAt = (index: number) => index % 10;

describe('nextIndex', () => {
  it('rolls down for a drop, even from 0 to 9', () => {
    const index = nextIndex(10, 0, 9, 'down');
    expect(index).toBe(9);
    expect(digitAt(index)).toBe(9);
  });

  it('rolls up for a rise, even from 9 to 0', () => {
    const index = nextIndex(19, 9, 0, 'up');
    expect(index).toBe(20);
    expect(digitAt(index)).toBe(0);
  });

  it('takes the short way within one copy', () => {
    expect(nextIndex(16, 6, 4, 'down')).toBe(14);
    expect(nextIndex(14, 4, 6, 'up')).toBe(16);
  });

  it('restarts from the middle copy rather than run off the end of the strip', () => {
    const index = nextIndex(2, 2, 5, 'down');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(digitAt(index)).toBe(5);
  });
});
