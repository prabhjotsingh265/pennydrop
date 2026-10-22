import { describe, expect, it } from 'vitest';
import { channelKey, newSigningSecret, open, seal, sign, verify } from './crypto.ts';

const key = channelKey('test secret');

describe('sealing channel settings', () => {
  it('opens what it sealed, and seals the same value differently each time', () => {
    const settings = { url: 'https://hooks.slack.com/services/example/channel/token' };
    const a = seal(settings, key);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('hooks.slack.com');
    expect(open(a, key)).toEqual(settings);
    expect(seal(settings, key)).not.toBe(a);
  });

  it('refuses a changed value, or the wrong key', () => {
    const sealed = seal({ url: 'x' }, key);
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    raw[raw.length - 1]! ^= 1;
    expect(() => open(`v1.${raw.toString('base64url')}`, key)).toThrow();
    expect(() => open(sealed, channelKey('another secret'))).toThrow();
  });
});

describe('signed webhooks', () => {
  const secret = newSigningSecret();
  const body = '{"type":"price.alert"}';
  const now = Date.UTC(2026, 9, 22, 12);
  const t = now / 1000;

  it('signs the timestamp and body together, and checks it', () => {
    const header = sign(body, secret, t);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verify(header, body, secret, now)).toBe(true);
  });

  it('turns away a changed body, the wrong secret, and an old message', () => {
    const header = sign(body, secret, t);
    expect(verify(header, '{"type":"other"}', secret, now)).toBe(false);
    expect(verify(header, body, newSigningSecret(), now)).toBe(false);
    expect(verify(header, body, secret, now + 10 * 60_000)).toBe(false);
    expect(verify('nonsense', body, secret, now)).toBe(false);
  });
});
