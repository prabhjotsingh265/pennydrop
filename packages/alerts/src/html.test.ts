import { describe, expect, it } from 'vitest';
import { emailHtml, escapeHtml } from './html.ts';
import { compose } from './messages.ts';

describe('emailHtml', () => {
  it('escapes everything it is given, and links only to web addresses', () => {
    const html = emailHtml({
      preheader: 'p',
      heading: '<script>alert(1)</script> Kettle',
      button: { label: 'Open', href: 'javascript:alert(1)' },
      links: [{ label: 'Shop', href: 'https://shop.example.com/p?a=1&b=2' }],
      footer: 'f',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Kettle');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="https://shop.example.com/p?a=1&amp;b=2"');
  });

  it('has a dark version for mail apps that ask for one', () => {
    const html = emailHtml({ preheader: 'p', heading: 'h', footer: 'f' });
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('an alert email', () => {
  it('leads with the product and its price, then lists why, with the way back to it', () => {
    const { html } = compose({
      alertId: 'a1',
      label: 'Copper kettle',
      host: 'fickle.example.com',
      url: 'https://fickle.example.com/p/kettle',
      link: 'https://pennydrop.example.com/app/p/w1',
      price: 4800,
      currency: 'GBP',
      kinds: ['below_target'],
      reasons: ['At or below your £50.00 target'],
      verified: true,
      firedAt: '2026-10-22T12:00:00.000Z',
    });
    expect(html).toContain('>Copper kettle</h1>');
    expect(html).toContain('£48.00');
    expect(html).toContain('At or below your £50.00 target');
    expect(html).toContain('Verified twice');
    expect(html).toContain('href="https://pennydrop.example.com/app/p/w1"');
  });
});

describe('a test email', () => {
  it('says why it came, and offers no shop', () => {
    const { html } = compose({
      alertId: 'test',
      label: 'A test from Pennydrop',
      host: 'pennydrop',
      url: 'https://pennydrop.example.com',
      link: 'https://pennydrop.example.com/app/channels',
      price: 1999,
      currency: 'GBP',
      kinds: [],
      reasons: ['“Me” is set up'],
      test: true,
      firedAt: '2026-10-22T12:00:00.000Z',
    });
    expect(html).toContain('pressed “Send a test”');
    expect(html).not.toContain('The shop’s page');
  });
});
