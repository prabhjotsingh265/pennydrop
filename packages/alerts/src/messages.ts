import { formatMoney, type RuleKind } from '@pennydrop/domain';

/** One alert, with everything any channel needs to say it. */
export interface AlertContent {
  alertId: string;
  label: string;
  host: string;
  /** The product's page at the shop. */
  url: string;
  /** Its page in Pennydrop. */
  link: string;
  price: number | null;
  currency: string;
  kinds: RuleKind[];
  /** Ready-made words for each rule met. */
  reasons: string[];
  firedAt: string;
}

export interface Reasons {
  price: number | null;
  previous: number | null;
  target: number | null;
  currency: string;
  threshold?: number | null;
  /** For "undercut": the shop now cheaper, and its price. */
  rival?: { host: string; price: number } | null;
}

/** Why an alert fired, in words, for each rule it met. */
export function reasonFor(kind: RuleKind, r: Reasons): string {
  const money = (minor: number) => formatMoney(minor, r.currency);
  switch (kind) {
    case 'below_target':
      return r.target === null ? 'At your target' : `At or below your ${money(r.target)} target`;
    case 'drop_percent':
      return r.previous && r.price !== null
        ? `Down ${Math.round((1 - r.price / r.previous) * 100)}% from ${money(r.previous)}`
        : 'A big drop';
    case 'any_drop':
      return r.previous && r.price !== null
        ? `Down ${money(r.previous - r.price)} from ${money(r.previous)}`
        : 'The price dropped';
    case 'back_in_stock':
      return 'Back in stock';
    case 'lowest_ever':
      return 'The lowest since you started watching';
    case 'undercut':
      return r.rival && r.price !== null
        ? `${r.rival.host} is now ${money(r.rival.price)}, ${money(r.price - r.rival.price)} under your listing`
        : 'A rival is cheaper than your listing';
  }
}

export interface Message {
  subject: string;
  text: string;
  slack: { text: string };
  discord: {
    embeds: { title: string; url: string; description: string; color: number; timestamp: string }[];
  };
  webhook: Record<string, unknown>;
}

const COPPER = 0xd77f3d;

/** One alert as an email, a Slack message, a Discord embed and a webhook body. */
export function compose(alert: AlertContent): Message {
  const price = alert.price === null ? 'no price' : formatMoney(alert.price, alert.currency);
  const headline = `${alert.label}: ${price}`;
  const lines = alert.reasons.map((reason) => `• ${reason}`).join('\n');
  return {
    subject: `${headline} (${alert.reasons[0]?.toLowerCase() ?? 'price alert'})`,
    text: `${headline} at ${alert.host}\n\n${lines}\n\nSee it in Pennydrop: ${alert.link}\nThe shop’s page: ${alert.url}\n`,
    slack: { text: `*<${alert.link}|${headline}>* at ${alert.host}\n${lines}` },
    discord: {
      embeds: [
        {
          title: headline,
          url: alert.link,
          description: `${alert.host}\n${lines}`,
          color: COPPER,
          timestamp: alert.firedAt,
        },
      ],
    },
    webhook: {
      type: 'price.alert',
      id: alert.alertId,
      product: { label: alert.label, shop: alert.host, url: alert.url, link: alert.link },
      price:
        alert.price === null
          ? null
          : { amount: alert.price, currency: alert.currency, display: price },
      rules: alert.kinds,
      reasons: alert.reasons,
      firedAt: alert.firedAt,
    },
  };
}

/** Several alerts held back (quiet hours, the digest, a busy hour) as one message. */
export function composeSummary(alerts: readonly AlertContent[], why: string): Message {
  const items = alerts.map((alert) => {
    const price = alert.price === null ? 'no price' : formatMoney(alert.price, alert.currency);
    return {
      alert,
      line: `${alert.label}: ${price} at ${alert.host}. ${alert.reasons.join('; ')}`,
    };
  });
  const subject = `${alerts.length} price ${alerts.length === 1 ? 'alert' : 'alerts'} ${why}`;
  return {
    subject,
    text: `${subject}\n\n${items.map((i) => `• ${i.line}\n  ${i.alert.link}`).join('\n')}\n`,
    slack: {
      text: `*${subject}*\n${items.map((i) => `• <${i.alert.link}|${i.line}>`).join('\n')}`,
    },
    discord: {
      embeds: [
        {
          title: subject,
          url: alerts[0]?.link ?? '',
          description: items
            .map((i) => `• ${i.line}`)
            .join('\n')
            .slice(0, 4_000),
          color: COPPER,
          timestamp: new Date().toISOString(),
        },
      ],
    },
    webhook: {
      type: 'price.alert.summary',
      reason: why,
      alerts: alerts.map((a) => compose(a).webhook),
    },
  };
}
