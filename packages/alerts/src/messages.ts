import { formatMoney, type RuleKind } from '@pennydrop/domain';
import { emailHtml } from './html.ts';

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
  /** A big jump, confirmed by a second check before anyone was told. */
  verified?: boolean;
  /** From a demo workspace: said so, since its visitor may have typed anyone's address. */
  demo?: boolean;
  /** "Send a test" on a channel: no product, no shop, just proof it arrives. */
  test?: boolean;
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
  /** The email's HTML, beside its text. */
  html: string;
  slack: { text: string };
  discord: {
    embeds: { title: string; url: string; description: string; color: number; timestamp: string }[];
  };
  webhook: Record<string, unknown>;
}

const COPPER = 0xd77f3d;

/** "At or below…" reads "at or below…" mid-sentence; a quoted name keeps its capitals. */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** One alert as an email, a Slack message, a Discord embed and a webhook body. */
export function compose(alert: AlertContent): Message {
  const price = alert.price === null ? 'no price' : formatMoney(alert.price, alert.currency);
  const headline = `${alert.label}: ${price}`;
  const said = [
    ...alert.reasons,
    ...(alert.verified ? ['Verified twice: a change this big is always checked again'] : []),
  ];
  const lines = said.map((line) => `• ${line}`).join('\n');
  const demoNote =
    'This came from a Pennydrop demo, which someone started with this address. It stops within a day.';
  return {
    subject: `${alert.demo ? '[Demo] ' : ''}${headline} (${alert.reasons[0] ? lowerFirst(alert.reasons[0]) : 'price alert'})`,
    text: `${headline} at ${alert.host}\n\n${lines}\n\nSee it in Pennydrop: ${alert.link}\nThe shop’s page: ${alert.url}\n${
      alert.demo
        ? '\nThis came from a Pennydrop demo, which someone started with this address. It stops within a day.\n'
        : ''
    }`,
    html: emailHtml({
      preheader: alert.reasons[0] ?? `${alert.label} is now ${price}`,
      heading: alert.label,
      figure: { value: price, note: `at ${alert.host}` },
      items: said,
      paragraphs: alert.demo ? [demoNote] : [],
      button: { label: 'See it in Pennydrop', href: alert.link },
      links: alert.test ? [] : [{ label: 'The shop’s page', href: alert.url }],
      footer: alert.test
        ? 'You get this because someone pressed “Send a test” on this channel in Pennydrop.'
        : 'You get this because a rule on this product fired. Change its rules on its page in Pennydrop, or where alerts go under Alert channels.',
    }),
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
      verified: alert.verified ?? false,
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
  const inbox = alerts[0] ? new URL('/app/alerts', alerts[0].link).toString() : null;
  return {
    subject,
    text: `${subject}\n\n${items.map((i) => `• ${i.line}\n  ${i.alert.link}`).join('\n')}\n`,
    html: emailHtml({
      preheader: items[0]?.line ?? subject,
      heading: subject.charAt(0).toUpperCase() + subject.slice(1),
      paragraphs: ['Held back and sent together, as your settings ask.'],
      items: items.map((i) => i.line),
      ...(inbox ? { button: { label: 'Open your alerts', href: inbox } } : {}),
      footer: 'Change quiet hours or the daily summary in Pennydrop’s Settings.',
    }),
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
