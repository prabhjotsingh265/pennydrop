import { z } from 'zod';

/** Demo workspaces, their visitors and their sandbox shops are deleted this long after they begin. */
export const DEMO_HOURS = 24;

/**
 * What every demo workspace watches. These pages are shared, so their history
 * (replayed, then live) is already there on the first visit. The kettle is
 * the same product at all three shops, compared, with Fickle's as "yours".
 */
export interface ShowcaseItem {
  shop: 'fickle' | 'slowpoke' | 'brittle';
  slug: string;
  group?: string;
  mine?: boolean;
  /** A target a little under today's price. */
  target?: boolean;
}

export const SHOWCASE: readonly ShowcaseItem[] = [
  { shop: 'fickle', slug: 'copper-kettle', group: 'Copper kettle', mine: true },
  { shop: 'slowpoke', slug: 'copper-kettle', group: 'Copper kettle' },
  { shop: 'brittle', slug: 'copper-kettle', group: 'Copper kettle' },
  { shop: 'fickle', slug: 'ribbed-vase', target: true },
  { shop: 'fickle', slug: 'oak-board', target: true },
];

/** The product each visitor gets on their own copy of the shop, to break as they like. */
export const SANDBOX_PRODUCT = 'stoneware-mug';

/** Local development's practice shops; production sets PRACTICE_SHOP_URL. */
export const LOCAL_PRACTICE_SHOP_URL = 'http://{shop}.localhost:4000';

/** A practice shop's page: `{shop}` in the template is "fickle", "brittle" or "sandbox-<token>". */
export function practiceUrl(template: string, shop: string, path: string): string {
  return new URL(path, template.replace('{shop}', shop)).toString();
}

/** A target 10% under a price, in whole 50p steps, as a demo starts with. */
export function demoTarget(price: number): number {
  return Math.max(50, Math.floor((price * 0.9) / 50) * 50);
}

/** The "Break the shop" buttons, and "Fix it", which puts everything back. */
export const BREAK_ACTIONS = ['redesign', 'slow', 'fail', 'sell_out', 'sale', 'fix'] as const;
export type BreakAction = (typeof BREAK_ACTIONS)[number];
export const breakSchema = z.strictObject({ action: z.enum(BREAK_ACTIONS) });

/** How the visitor's own shop is behaving, as the panel shows it. */
export interface SandboxState {
  redesigned: boolean;
  slow: boolean;
  failing: boolean;
  soldOut: boolean;
  onSale: boolean;
}

export interface DemoState {
  expiresAt: string;
  sandbox: { watchId: string; url: string; state: SandboxState } | null;
}
