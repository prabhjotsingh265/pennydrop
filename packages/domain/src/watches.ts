import { z } from 'zod';

/** How often a product can be checked, in seconds. Fifteen minutes is for the practice shops only. */
export const INTERVALS = [900, 3_600, 21_600, 43_200, 86_400] as const;
export const DEFAULT_INTERVAL = 21_600;

export const intervalSchema = z.union(
  INTERVALS.map((seconds) => z.literal(seconds)) as [z.ZodLiteral<900>, ...z.ZodLiteral<number>[]],
);

/** Minor units: whole pence, cents, paise. */
const money = z.number().int().positive().max(1e13);

/** A preview, and which of the prices on its screenshot was picked. */
const pickedSchema = z.strictObject({ id: z.uuid(), choice: z.number().int().min(0).max(100) });

export const addWatchSchema = z.strictObject({
  url: z.string().trim().min(1).max(2_000),
  label: z.string().trim().max(120).optional(),
  targetPrice: money.optional(),
  intervalSeconds: intervalSchema.default(DEFAULT_INTERVAL),
  /** The preview it was added from, and which of its prices was picked. */
  preview: pickedSchema.optional(),
});
export type AddWatchInput = z.input<typeof addWatchSchema>;

export const updateWatchSchema = z.strictObject({
  label: z.string().trim().max(120).nullable().optional(),
  targetPrice: money.nullable().optional(),
  intervalSeconds: intervalSchema.optional(),
  paused: z.boolean().optional(),
  isMine: z.boolean().optional(),
  /** The group it's compared in, or null to take it out. */
  groupId: z.uuid().nullable().optional(),
});
export type UpdateWatchInput = z.input<typeof updateWatchSchema>;

export const previewSchema = z.strictObject({
  url: z.string().trim().min(1).max(2_000),
  /** For a product already on the watchlist whose price is being picked again. */
  repick: z.boolean().optional(),
});

/** Picking the price again on a product already watched. */
export const pickSchema = z.strictObject({ preview: pickedSchema });

/** The most addresses one bulk add takes. */
export const BULK_MAX = 50;

export const bulkAddSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        url: z.string().trim().min(1).max(2_000),
        label: z.string().trim().max(120).optional(),
        targetPrice: money.optional(),
      }),
    )
    .min(1)
    .max(BULK_MAX),
  intervalSeconds: intervalSchema.default(DEFAULT_INTERVAL),
});
export type BulkAddInput = z.input<typeof bulkAddSchema>;

/** How one line of a bulk add went. */
export type BulkResult =
  | { url: string; ok: true; watchId: string; created: boolean }
  | { url: string; ok: false; error: string };

export type WatchStatus = 'active' | 'needs_attention' | 'blocked' | 'gone' | 'paused';

/** A product on the watchlist, as the dashboard shows it. Money is in minor units. */
export interface WatchSummary {
  id: string;
  targetId: string;
  label: string;
  url: string;
  host: string;
  currency: string | null;
  price: number | null;
  targetPrice: number | null;
  inStock: boolean | null;
  status: WatchStatus;
  paused: boolean;
  isMine: boolean;
  groupId: string | null;
  intervalSeconds: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  /** Change points over the last 30 days, oldest first: each price holds until the next. */
  history: { t: string; price: number | null; inStock: boolean }[];
}

/** Something worth showing on a product's timeline. Site-wide ones (a redesign, a breaker) touch every product there. */
export interface WatchEvent {
  id: string;
  kind: string;
  at: string;
  details: Record<string, unknown>;
  siteWide: boolean;
}

/**
 * Whether a shop's "was" price is one it really charged. In the EU it must be
 * the lowest price of the 30 days before the reduction (Directive 2019/2161).
 */
export interface DiscountCheck {
  /** The "was" price the shop shows now, and the price. */
  was: number;
  price: number;
  currency: string;
  /** When the shop began showing a "was" price. */
  since: string;
  /** The lowest price we saw in the 30 days before that, and when it began; null if we saw none. */
  lowestBefore: number | null;
  lowestAt: string | null;
  /** Days of history before the sale, up to 30. */
  days: number;
  /**
   * "inflated": we saw it cheaper than the "was" price in those 30 days.
   * "honest": we watched all 30 days and never saw it cheaper.
   * "too_soon": we haven't watched long enough to say.
   */
  verdict: 'honest' | 'inflated' | 'too_soon';
}

export interface WatchDetail {
  /** With its whole history, not just the last 30 days. */
  watch: WatchSummary;
  events: WatchEvent[];
  /** Only while the shop shows a "was" price. */
  discount: DiscountCheck | null;
}

/** One check of a product page, for the check log and its waterfall. */
export interface CheckSummary {
  id: string;
  reason: string;
  mode: 'http' | 'browser' | null;
  outcome: string;
  startedAt: string;
  finishedAt: string;
  httpStatus: number | null;
  /** Milliseconds per step: robots, http, browser, total. */
  timings: Record<string, number> | null;
  strategy: string | null;
  confidence: number | null;
  price: number | null;
  currency: string | null;
  inStock: boolean | null;
  detail: string | null;
  /** A failed browser check's screenshot is kept for 7 days. */
  screenshot: boolean;
}
