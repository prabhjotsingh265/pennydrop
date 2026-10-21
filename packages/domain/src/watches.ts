import { z } from 'zod';

/** How often a product can be checked, in seconds. Fifteen minutes is for the practice shops only. */
export const INTERVALS = [900, 3_600, 21_600, 43_200, 86_400] as const;
export const DEFAULT_INTERVAL = 21_600;

export const intervalSchema = z.union(
  INTERVALS.map((seconds) => z.literal(seconds)) as [z.ZodLiteral<900>, ...z.ZodLiteral<number>[]],
);

/** Minor units: whole pence, cents, paise. */
const money = z.number().int().positive().max(1e13);

export const addWatchSchema = z.strictObject({
  url: z.string().trim().min(1).max(2_000),
  label: z.string().trim().max(120).optional(),
  targetPrice: money.optional(),
  intervalSeconds: intervalSchema.default(DEFAULT_INTERVAL),
  /** The element someone clicked on the preview's screenshot, when the automatic pick was wrong. */
  picked: z
    .strictObject({
      selector: z.string().min(1).max(500),
      attribute: z.string().max(50).optional(),
    })
    .optional(),
});
export type AddWatchInput = z.input<typeof addWatchSchema>;

export const updateWatchSchema = z.strictObject({
  label: z.string().trim().max(120).nullable().optional(),
  targetPrice: money.nullable().optional(),
  intervalSeconds: intervalSchema.optional(),
  paused: z.boolean().optional(),
  isMine: z.boolean().optional(),
});
export type UpdateWatchInput = z.input<typeof updateWatchSchema>;

export const previewSchema = z.strictObject({ url: z.string().trim().min(1).max(2_000) });

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
  intervalSeconds: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  /** Change points over the last 30 days, oldest first: each price holds until the next. */
  history: { t: string; price: number | null; inStock: boolean }[];
}
