import { describe, expect, it } from 'vitest';
import { configFromEnv, trustProxyFrom } from './config.ts';

describe('configFromEnv', () => {
  it('treats blank values as missing', () => {
    const config = configFromEnv({ AUTH_SECRET: '', MAILPIT_URL: '', RESEND_API_KEY: '' });
    expect(config.authSecret).toBe('development-only-secret-not-for-production');
    expect(config.mail).toEqual({ from: 'Pennydrop <hello@pennydrop.test>' });
  });

  it('opens the demo where the practice shops can be reached', () => {
    expect(configFromEnv({}).demo).toBeNull();
    expect(configFromEnv({ LOCAL_SHOP_HOST: 'shop' }).demo).toEqual({
      practiceShopUrl: 'http://{shop}.localhost:4000',
      shopInternalUrl: 'http://shop:4000',
    });
    expect(
      configFromEnv({
        PRACTICE_SHOP_URL: 'https://{shop}.example.com',
        SHOP_INTERNAL_URL: 'http://shop:4000',
        SHOP_CHAOS_TOKEN: 't',
      }).demo,
    ).toMatchObject({ practiceShopUrl: 'https://{shop}.example.com', chaosToken: 't' });
  });

  it('lists the admins by email, however they’re written', () => {
    expect(configFromEnv({}).adminEmails).toEqual([]);
    expect(
      configFromEnv({ ADMIN_EMAILS: ' Me@Example.com, ops@example.com ,' }).adminEmails,
    ).toEqual(['me@example.com', 'ops@example.com']);
  });

  it('believes a proxy about addresses only when told to', () => {
    expect(configFromEnv({}).trustProxy).toBe(false);
    expect(trustProxyFrom('true')).toBe(true);
    expect(trustProxyFrom('loopback')).toEqual(['loopback']);
    expect(trustProxyFrom('127.0.0.1, 10.0.0.0/8')).toEqual(['127.0.0.1', '10.0.0.0/8']);
    expect(trustProxyFrom(' ')).toBe(false);
  });

  it('won’t start in production without a secret', () => {
    expect(() => configFromEnv({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
    expect(() => configFromEnv({ NODE_ENV: 'production', AUTH_SECRET: 'x' })).toThrow(
      /CHANNELS_KEY/,
    );
  });

  it('won’t start in production without a way to send email', () => {
    const secrets = { NODE_ENV: 'production', AUTH_SECRET: 'x', CHANNELS_KEY: 'y' };
    expect(() => configFromEnv(secrets)).toThrow(/RESEND_API_KEY/);
    expect(configFromEnv({ ...secrets, RESEND_API_KEY: 'key' }).mail.resendKey).toBe('key');
    // Development prints emails instead.
    expect(configFromEnv({}).mail).toEqual({ from: 'Pennydrop <hello@pennydrop.test>' });
  });
});
