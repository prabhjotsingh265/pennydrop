import {
  REARM_MARGIN,
  type ChannelKind,
  type DeliveryStatus,
  type RuleSummary,
} from '@pennydrop/domain';
import { formatMoney } from './money.ts';

/** "22:00" for a time input, from minutes after midnight. */
export function minutesToTime(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Minutes after midnight from a time input's "07:30"; null when it isn't one. */
export function timeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Why a rule that's on won't fire right now, or null when it's ready. "Below
 * target" and "undercut" fire once, then wait for the reason to go away.
 */
export function ruleWaiting(
  rule: Pick<RuleSummary, 'kind' | 'armed'>,
  target: number | null,
  currency: string,
): string | null {
  if (rule.armed) return null;
  if (rule.kind === 'below_target' && target !== null) {
    const again = Math.round(target * (1 + REARM_MARGIN));
    return `Alerts again once the price has been above ${formatMoney(again, currency)}`;
  }
  if (rule.kind === 'undercut') return 'Alerts again once no shop is cheaper than you';
  return null;
}

export const KIND_LABELS: Record<ChannelKind, string> = {
  email: 'Email',
  slack: 'Slack',
  discord: 'Discord',
  webhook: 'Webhook',
};

/** What a delivery's status means, for the inbox. */
export const DELIVERY_WORDS: Record<DeliveryStatus, string> = {
  sent: 'sent',
  pending: 'sending',
  batched: 'held for a summary',
  failed: 'failed',
  skipped: 'skipped: the channel is broken',
};

/** The address field for each kind of channel: its label, an example, and where to find it. */
export const CHANNEL_HELP: Record<
  ChannelKind,
  { label: string; placeholder: string; hint: string; type: 'email' | 'url' }
> = {
  email: {
    label: 'Email address',
    placeholder: 'you@example.com',
    hint: 'Each alert arrives as a plain email.',
    type: 'email',
  },
  slack: {
    label: 'Slack incoming webhook',
    placeholder: 'https://hooks.slack.com/services/…',
    hint: 'Make one in Slack with an app’s Incoming Webhooks. It starts with https://hooks.slack.com/services/.',
    type: 'url',
  },
  discord: {
    label: 'Discord webhook',
    placeholder: 'https://discord.com/api/webhooks/…',
    hint: 'In Discord: Server Settings, Integrations, Webhooks, New Webhook, then Copy Webhook URL.',
    type: 'url',
  },
  webhook: {
    label: 'Your endpoint',
    placeholder: 'https://example.com/pennydrop',
    hint: 'Each alert is posted to it as signed JSON. It must use https://.',
    type: 'url',
  },
};
