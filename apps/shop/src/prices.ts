import type { Product } from './catalogue.ts';
import { hash01 } from './random.ts';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

/** Monday 5 January 2026, midnight UTC: the shop's first day of trading. */
export const OPENED = Date.UTC(2026, 0, 5);

const SLOT = 6 * HOUR;
const CHANGE_CHANCE = 0.12;
const SALE_WEEK_CHANCE = 0.3;
const INFLATER_CHANCE = 0.2;
const SOLD_OUT_CHANCE = 0.04;

export interface Quote {
  /** Pence. */
  price: number;
  /** The "was" price shown during a sale. */
  was: number | null;
  inStock: boolean;
  currency: 'GBP';
}

export interface QuoteOverrides {
  stock?: 'auto' | 'in' | 'out';
  sale?: 'auto' | 'on' | 'off';
}

/** Shops price at .99 or in 50p steps, never at 47.13. */
function shelf(product: Product, raw: number): number {
  return product.charm
    ? Math.max(99, Math.round(raw / 100) * 100 - 1)
    : Math.max(50, Math.round(raw / 50) * 50);
}

// The walk is replayed from the opening day, so it's remembered per product
// and only extended as time moves forward.
const walks = new Map<string, { slot: number; raw: number }>();

/**
 * The regular price drifts. Every six hours there's a 12% chance it moves by
 * between -6% and +5%, and it stays within 72%–118% of where it started.
 */
function drifted(product: Product, slot: number): number {
  let state = walks.get(product.slug);
  if (!state || state.slot > slot) state = { slot: 0, raw: product.base };
  let raw = state.raw;
  for (let i = state.slot + 1; i <= slot; i++) {
    if (hash01(product.slug, 'move', i) < CHANGE_CHANCE) {
      raw *= 0.94 + hash01(product.slug, 'by', i) * 0.11;
      raw = Math.min(Math.max(raw, product.base * 0.72), product.base * 1.18);
    }
  }
  walks.set(product.slug, { slot, raw });
  return raw;
}

/** Whether this product puts its regular price up before a sale, to make the sale look bigger. */
export function inflatesBeforeSales(product: Product): boolean {
  return hash01(product.slug, 'inflates') < INFLATER_CHANCE;
}

/**
 * What the shop shows for a product at a moment. Some weeks have a Friday and
 * Saturday sale; on those weeks, inflaters raise the regular price by 20% from
 * Monday, so the "was" price is one that was only charged for a few days.
 */
export function quote(product: Product, at: number, overrides: QuoteOverrides = {}): Quote {
  const elapsed = Math.max(0, at - OPENED);
  const week = Math.floor(elapsed / WEEK);
  const weekday = Math.floor((elapsed % WEEK) / DAY); // 0 is Monday
  const day = Math.floor(elapsed / DAY);

  const saleWeek = hash01(product.slug, 'sale', week) < SALE_WEEK_CHANCE;
  const onSale =
    overrides.sale === 'on' ||
    (overrides.sale !== 'off' && saleWeek && (weekday === 4 || weekday === 5));

  const raw = drifted(product, Math.floor(elapsed / SLOT));
  const inflated = saleWeek && inflatesBeforeSales(product) && weekday <= 5;
  const regular = shelf(product, inflated ? raw * 1.2 : raw);
  const price = onSale
    ? shelf(product, regular * (0.72 + hash01(product.slug, 'cut', week) * 0.12))
    : regular;

  const inStock =
    overrides.stock === 'in' ||
    (overrides.stock !== 'out' && hash01(product.slug, 'stock', day) >= SOLD_OUT_CHANCE);

  return { price, was: onSale ? regular : null, inStock, currency: 'GBP' };
}

export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
