import { z } from 'zod';

export const RULE_KINDS = [
  'below_target',
  'drop_percent',
  'any_drop',
  'back_in_stock',
  'lowest_ever',
  'undercut',
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** "Below target" re-arms only once the price is back this far above it: a wobble alerts once. */
export const REARM_MARGIN = 0.02;

/** A rule to add or change on a product. "Drops by X%" needs its X. */
export const ruleSchema = z
  .strictObject({
    kind: z.enum(RULE_KINDS),
    threshold: z.number().int().min(1).max(90).optional(),
  })
  .refine((rule) => rule.kind !== 'drop_percent' || rule.threshold !== undefined, {
    message: 'Say by how many per cent.',
    path: ['threshold'],
  });
export type RuleInput = z.input<typeof ruleSchema>;

export interface RuleSummary {
  id: string;
  kind: RuleKind;
  threshold: number | null;
  /** Ready to fire. Off after firing until the price climbs back past the target by the margin. */
  armed: boolean;
  lastFiredAt: string | null;
}

/** What each rule means, in a few words. */
export function ruleWords(kind: RuleKind, threshold: number | null = null): string {
  switch (kind) {
    case 'below_target':
      return 'Drops to my target or below';
    case 'drop_percent':
      return `Drops by ${threshold ?? 'X'}% or more at once`;
    case 'any_drop':
      return 'Drops at all';
    case 'back_in_stock':
      return 'Comes back in stock';
    case 'lowest_ever':
      return 'Is the lowest since I started watching';
    case 'undercut':
      return 'A shop in its group is cheaper than my listing';
  }
}

export const CHANNEL_KINDS = ['email', 'slack', 'discord', 'webhook'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

const name = z.string().trim().min(1).max(60);
const url = z.string().trim().max(2_000);

/** A new channel. Addresses are checked further on the server, which knows where they may point. */
export const channelSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('email'),
    name,
    address: z.email('That doesn’t look like an email address.'),
  }),
  z.strictObject({ kind: z.literal('slack'), name, url }),
  z.strictObject({ kind: z.literal('discord'), name, url }),
  z.strictObject({ kind: z.literal('webhook'), name, url }),
]);
export type ChannelInput = z.input<typeof channelSchema>;

export interface ChannelSummary {
  id: string;
  kind: ChannelKind;
  name: string;
  /** Where it goes, masked: "hooks.slack.com/…/a1b2". */
  hint: string;
  status: 'active' | 'broken';
  lastError: string | null;
  lastSentAt: string | null;
}

export type DeliveryStatus = 'pending' | 'batched' | 'sent' | 'failed' | 'skipped';

/** One alert in the inbox: a product's new price, and every rule it met. */
export interface AlertSummary {
  id: string;
  watchId: string;
  label: string;
  host: string;
  kinds: RuleKind[];
  price: number | null;
  previousPrice: number | null;
  currency: string | null;
  /** Words for each rule met, ready to show: "At or below your £55.00 target". */
  reasons: string[];
  /** A big jump, confirmed by a second check first. */
  verified: boolean;
  firedAt: string;
  readAt: string | null;
  deliveries: { channel: string; kind: ChannelKind; status: DeliveryStatus }[];
}
