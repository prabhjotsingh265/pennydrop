import type { PreviewChoice } from '@pennydrop/domain';
import { describe, expect, it } from 'vitest';
import { describeChoice, firstChoice } from './picker.ts';

const choice = (y: number, height: number, extra: Partial<PreviewChoice> = {}): PreviewChoice => ({
  text: '£1.00',
  amount: 100,
  currency: 'GBP',
  x: 0,
  y,
  width: 80,
  height,
  struck: false,
  best: false,
  ...extra,
});

describe('describeChoice', () => {
  const all = [
    choice(500, 44, { best: true }),
    choice(300, 20, { struck: true }),
    choice(1_200, 17),
  ];
  it('says how big each price is and where it sits', () => {
    expect(describeChoice(all[0]!, all, 1_400)).toBe('the largest, halfway down');
    expect(describeChoice(all[1]!, all, 1_400)).toBe(
      'small, near the top, crossed out, so a “was” price',
    );
    expect(describeChoice(all[2]!, all, 1_400)).toBe('small, near the bottom');
  });

  it('starts on the automatic pick, when there is one', () => {
    expect(firstChoice(all)).toBe(0);
    expect(firstChoice([choice(10, 10)])).toBeNull();
  });
});
