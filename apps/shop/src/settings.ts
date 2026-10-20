import { z } from 'zod';

/** One service, three shops: which one answers depends on the hostname. */
export type ShopName = 'fickle' | 'slowpoke' | 'brittle';

export const SHOPS: Record<ShopName, { tagline: string }> = {
  fickle: { tagline: 'Things for the kitchen, the desk and home.' },
  slowpoke: { tagline: 'Good things, eventually.' },
  brittle: { tagline: 'Usually open.' },
};

export function shopFor(hostname: string): ShopName {
  const label = hostname.split('.')[0] ?? '';
  return Object.hasOwn(SHOPS, label) ? (label as ShopName) : 'fickle';
}

const rate = z.number().min(0).max(1);
const millis = z.number().int().min(0).max(120_000);

// Strict: an unknown setting is a mistake, so it's refused rather than ignored.
const settingsSchema = z
  .strictObject({
    /** classic: clean markup; redesign: renamed and moved; modern: generated classes, price loaded by script. */
    layout: z.enum(['classic', 'redesign', 'modern']),
    /** Structured data the classic layout carries. The other layouts never do. */
    jsonLd: z.boolean(),
    microdata: z.boolean(),
    metaTags: z.boolean(),
    /** Every page waits somewhere between these, in milliseconds. */
    latencyMs: z.tuple([millis, millis]),
    /** Shares of page requests answered 500, 429 (with Retry-After) and 403. */
    errorRate: rate,
    rateLimitRate: rate,
    blockRate: rate,
    stock: z.enum(['auto', 'in', 'out']),
    sale: z.enum(['auto', 'on', 'off']),
    /** Seconds, published in robots.txt. */
    crawlDelay: z.number().int().min(0).max(60),
  })
  .refine(
    (s) => s.latencyMs[0] <= s.latencyMs[1],
    'The shortest wait must not be longer than the longest.',
  )
  .refine(
    (s) => s.errorRate + s.rateLimitRate + s.blockRate <= 1,
    'The failure rates add up to more than every request.',
  );

export type ShopSettings = z.infer<typeof settingsSchema>;

const HEALTHY: ShopSettings = {
  layout: 'classic',
  jsonLd: true,
  microdata: true,
  metaTags: true,
  latencyMs: [20, 120],
  errorRate: 0,
  rateLimitRate: 0,
  blockRate: 0,
  stock: 'auto',
  sale: 'auto',
  crawlDelay: 1,
};

export const DEFAULTS: Record<ShopName, ShopSettings> = {
  fickle: HEALTHY,
  slowpoke: { ...HEALTHY, latencyMs: [4_000, 20_000], crawlDelay: 5 },
  brittle: { ...HEALTHY, errorRate: 0.3, rateLimitRate: 0.1, blockRate: 0.05, crawlDelay: 2 },
};

/** Each shop's current settings, changed through the chaos controls. Kept in memory. */
export class SettingsStore {
  #current = new Map<ShopName, ShopSettings>();

  get(shop: ShopName): ShopSettings {
    return this.#current.get(shop) ?? DEFAULTS[shop];
  }

  /** Applies a partial change; anything invalid is refused whole. */
  update(shop: ShopName, patch: unknown): ShopSettings {
    const changes = z.record(z.string(), z.unknown()).parse(patch);
    const next = settingsSchema.parse({ ...this.get(shop), ...changes });
    this.#current.set(shop, next);
    return next;
  }

  reset(shop: ShopName): ShopSettings {
    this.#current.delete(shop);
    return DEFAULTS[shop];
  }
}
