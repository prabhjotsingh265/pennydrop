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

/** Where a request landed: one of the three shops, or a demo visitor's own copy of Fickle. */
export interface Place {
  shop: ShopName;
  /** The sandbox's token, for `sandbox-<token>.…` hosts. */
  sandbox: string | null;
}

const SANDBOX = /^sandbox-([a-z0-9]{8,40})$/;

export function placeFor(hostname: string): Place {
  const sandbox = SANDBOX.exec(hostname.split('.')[0] ?? '')?.[1] ?? null;
  return { shop: sandbox ? 'fickle' : shopFor(hostname), sandbox };
}

/** A sandbox nobody has changed for this long is forgotten: it's back to Fickle's defaults. */
export const SANDBOX_KEEP_MS = 2 * 86_400_000;
/** And at most this many are remembered; past it, the longest untouched go first. */
export const MAX_SANDBOXES = 10_000;

/**
 * Each shop's current settings, changed through the chaos controls, and each
 * sandbox's. Kept in memory: only what someone changed, so a sandbox nobody
 * touched costs nothing.
 */
export class SettingsStore {
  #shops = new Map<ShopName, ShopSettings>();
  /** In order of last change, oldest first. */
  #sandboxes = new Map<string, { settings: ShopSettings; touched: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get(where: ShopName | Place): ShopSettings {
    if (typeof where === 'string') return this.#shops.get(where) ?? DEFAULTS[where];
    if (!where.sandbox) return this.get(where.shop);
    return this.#sandboxes.get(where.sandbox)?.settings ?? DEFAULTS[where.shop];
  }

  /** Applies a partial change; anything invalid is refused whole. */
  update(where: ShopName | Place, patch: unknown): ShopSettings {
    const changes = z.record(z.string(), z.unknown()).parse(patch);
    const next = settingsSchema.parse({ ...this.get(where), ...changes });
    const sandbox = typeof where === 'string' ? null : where.sandbox;
    if (!sandbox) {
      this.#shops.set(typeof where === 'string' ? where : where.shop, next);
      return next;
    }
    this.#sandboxes.delete(sandbox);
    this.#sandboxes.set(sandbox, { settings: next, touched: this.#now() });
    // The oldest come first, so forgetting stops at the first one still wanted.
    const stale = this.#now() - SANDBOX_KEEP_MS;
    for (const [token, entry] of this.#sandboxes) {
      if (entry.touched >= stale && this.#sandboxes.size <= MAX_SANDBOXES) break;
      this.#sandboxes.delete(token);
    }
    return next;
  }

  reset(where: ShopName | Place): ShopSettings {
    if (typeof where === 'string' || !where.sandbox) {
      const shop = typeof where === 'string' ? where : where.shop;
      this.#shops.delete(shop);
      return DEFAULTS[shop];
    }
    this.#sandboxes.delete(where.sandbox);
    return DEFAULTS[where.shop];
  }

  /** How many sandboxes are remembered. */
  get sandboxes(): number {
    return this.#sandboxes.size;
  }
}
