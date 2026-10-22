import { describe, expect, it } from 'vitest';
import { configFromEnv, trustProxyFrom } from './config.ts';

describe('configFromEnv', () => {
  it('treats blank values as missing', () => {
    const config = configFromEnv({ AUTH_SECRET: '', MAILPIT_URL: '', RESEND_API_KEY: '' });
    expect(config.authSecret).toBe('development-only-secret-not-for-production');
    expect(config.mail).toEqual({ from: 'Pennydrop <hello@pennydrop.test>' });
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
});
