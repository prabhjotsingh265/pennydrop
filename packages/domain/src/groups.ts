import { z } from 'zod';
import type { WatchSummary } from './watches.ts';

/** The same item at several shops, compared side by side. */
export const groupSchema = z.strictObject({ name: z.string().trim().min(1).max(60) });
export type GroupInput = z.input<typeof groupSchema>;

export interface GroupSummary {
  id: string;
  name: string;
  products: number;
}

export interface GroupDetail {
  group: { id: string; name: string };
  /** In the order they joined: each keeps its colour on the chart. Up to 90 days of history. */
  watches: WatchSummary[];
}
