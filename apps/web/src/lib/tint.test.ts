import { describe, expect, it } from 'vitest';
import { distanceFromTarget, patina, proximityTint } from './tint.ts';

const lightness = (colour: string) => Number(/oklab\(([\d.]+)/.exec(colour)?.[1]);

describe('distanceFromTarget', () => {
  it('is the share of the target the price is above it', () => {
    expect(distanceFromTarget(5500, 5000)).toBeCloseTo(0.1);
    expect(distanceFromTarget(4500, 5000)).toBeCloseTo(-0.1);
  });
});

describe('proximityTint', () => {
  it('uses the far stop from 30% above and beyond', () => {
    expect(proximityTint(0.3, 'light')).toBe(proximityTint(0.9, 'light'));
    expect(lightness(proximityTint(0.5, 'light'))).toBeCloseTo(0.955);
  });

  it('uses the reached stop at or below the target', () => {
    expect(proximityTint(0, 'light')).toBe(proximityTint(-0.4, 'light'));
    expect(lightness(proximityTint(-0.1, 'light'))).toBeCloseTo(0.865);
  });

  it('blends between neighbouring stops', () => {
    // Halfway between 15% (L 0.945) and 5% (L 0.915).
    expect(lightness(proximityTint(0.1, 'light'))).toBeCloseTo(0.93);
  });

  it('gets darker in light mode and lighter in dark mode as the target nears', () => {
    const steps = [0.3, 0.2, 0.1, 0.03, 0];
    const light = steps.map((d) => lightness(proximityTint(d, 'light')));
    const dark = steps.map((d) => lightness(proximityTint(d, 'dark')));
    expect([...light].sort((a, b) => b - a)).toEqual(light);
    expect([...dark].sort((a, b) => a - b)).toEqual(dark);
  });
});

describe('patina', () => {
  it('stays copper while fresh and turns verdigris once stale', () => {
    expect(patina(0.5)).toContain('var(--verdigris-deep) 0%');
    expect(patina(1.5)).toContain('var(--verdigris-deep) 50%');
    expect(patina(4)).toContain('var(--verdigris-deep) 100%');
  });
});
