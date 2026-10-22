import { describe, expect, it } from 'vitest';
import { compose, composeSummary, reasonFor, type AlertContent } from './messages.ts';

const alert: AlertContent = {
  alertId: 'a1',
  label: 'Copper kettle',
  host: 'fickle.example.com',
  url: 'https://fickle.example.com/p/kettle',
  link: 'https://pennydrop.example.com/app/p/w1',
  price: 4800,
  currency: 'GBP',
  kinds: ['below_target', 'any_drop'],
  reasons: ['At or below your £50.00 target', 'Down £4.00 from £52.00'],
  firedAt: '2026-10-22T12:00:00.000Z',
};

describe('reasonFor', () => {
  const r = { price: 4800, previous: 5200, target: 5000, currency: 'GBP' };

  it('says why each rule fired, in words', () => {
    expect(reasonFor('below_target', r)).toBe('At or below your £50.00 target');
    expect(reasonFor('drop_percent', { ...r, threshold: 5 })).toBe('Down 8% from £52.00');
    expect(reasonFor('any_drop', r)).toBe('Down £4.00 from £52.00');
    expect(reasonFor('back_in_stock', r)).toBe('Back in stock');
    expect(
      reasonFor('undercut', { ...r, rival: { host: 'slowpoke.example.com', price: 4500 } }),
    ).toBe('slowpoke.example.com is now £45.00, £3.00 under your listing');
  });
});

describe('compose', () => {
  it('leads with the product and its price, then the first reason', () => {
    const message = compose(alert);
    expect(message.subject).toBe('Copper kettle: £48.00 (at or below your £50.00 target)');
    expect(message.text).toContain('• Down £4.00 from £52.00');
    expect(message.slack.text).toContain(`<${alert.link}|Copper kettle: £48.00>`);
    expect(message.discord.embeds[0]).toMatchObject({
      title: 'Copper kettle: £48.00',
      url: alert.link,
    });
    expect(message.webhook).toMatchObject({
      type: 'price.alert',
      id: 'a1',
      price: { amount: 4800, currency: 'GBP', display: '£48.00' },
      rules: ['below_target', 'any_drop'],
    });
  });

  it('says when a big change was checked twice', () => {
    const message = compose({ ...alert, verified: true });
    expect(message.text).toContain('• Verified twice: a change this big is always checked again');
    expect(message.webhook).toMatchObject({ verified: true });
    expect(compose(alert).webhook).toMatchObject({ verified: false });
  });

  it('says when it comes from a demo', () => {
    const message = compose({ ...alert, demo: true });
    expect(message.subject).toMatch(/^\[Demo\] Copper kettle: £48\.00/);
    expect(message.text).toContain('This came from a Pennydrop demo');
    expect(compose(alert).subject).not.toContain('[Demo]');
  });

  it('keeps the capitals of a quoted name', () => {
    const message = compose({ ...alert, reasons: ['“Team Slack” is set up'] });
    expect(message.subject).toBe('Copper kettle: £48.00 (“Team Slack” is set up)');
  });
});

describe('composeSummary', () => {
  it('gathers held alerts into one message', () => {
    const message = composeSummary(
      [alert, { ...alert, alertId: 'a2', label: 'Tall vase' }],
      'during your quiet hours',
    );
    expect(message.subject).toBe('2 price alerts during your quiet hours');
    expect(message.text).toContain('• Tall vase: £48.00 at fickle.example.com.');
    expect(message.webhook).toMatchObject({
      type: 'price.alert.summary',
      reason: 'during your quiet hours',
    });
    expect(composeSummary([alert], 'in your daily digest').subject).toBe(
      '1 price alert in your daily digest',
    );
  });
});
