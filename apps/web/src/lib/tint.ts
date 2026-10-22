export type Theme = 'light' | 'dark';

/** [lightness, chroma, hue] in OKLCH. */
type Oklch = readonly [number, number, number];

/**
 * Card tints by distance from the target: (price - target) / target.
 * Stops come from the design system; everything between is blended.
 */
const RAMP: Record<Theme, ReadonlyArray<readonly [number, Oklch]>> = {
  light: [
    [0.3, [0.955, 0.012, 225]],
    [0.15, [0.945, 0.035, 85]],
    [0.05, [0.915, 0.05, 62]],
    // At or under target: as copper as it can be with grey text on it still at 4.5:1.
    [0, [0.88, 0.075, 52]],
  ],
  dark: [
    [0.3, [0.235, 0.02, 225]],
    [0.15, [0.25, 0.035, 85]],
    [0.05, [0.28, 0.055, 62]],
    [0, [0.33, 0.075, 52]],
  ],
};

export function distanceFromTarget(price: number, target: number): number {
  return (price - target) / target;
}

/**
 * Blended in OKLab rather than by hue: slate to sand would otherwise swing
 * through green on the way round the colour wheel.
 */
function mixOklab(a: Oklch, b: Oklch, t: number): string {
  const toLab = ([l, c, h]: Oklch) => {
    const rad = (h * Math.PI) / 180;
    return [l, c * Math.cos(rad), c * Math.sin(rad)] as const;
  };
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return `oklab(${lerp(l1, l2).toFixed(4)} ${lerp(a1, a2).toFixed(4)} ${lerp(b1, b2).toFixed(4)})`;
}

export function proximityTint(distance: number, theme: Theme): string {
  const stops = RAMP[theme];
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (distance >= first[0]) return mixOklab(first[1], first[1], 0);
  if (distance <= last[0]) return mixOklab(last[1], last[1], 0);
  for (let i = 0; i < stops.length - 1; i++) {
    const [d1, c1] = stops[i]!;
    const [d2, c2] = stops[i + 1]!;
    if (distance <= d1 && distance >= d2) {
      return mixOklab(c1, c2, (d1 - distance) / (d1 - d2));
    }
  }
  return mixOklab(last[1], last[1], 0);
}

/**
 * Copper turns green with age. `age` is time since the last good check,
 * divided by the product's interval: under 1 is fresh, over 2 is stale.
 */
export function patina(age: number): string {
  const t = Math.min(Math.max((age - 1) / 1, 0), 1);
  return `color-mix(in oklab, var(--verdigris-deep) ${(t * 100).toFixed(0)}%, var(--copper-deep))`;
}
