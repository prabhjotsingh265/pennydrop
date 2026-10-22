import { describe, expect, it } from 'vitest';
import { configFromEnv } from './config.ts';

describe('configFromEnv', () => {
  it('treats blank values as missing', () => {
    const config = configFromEnv({ AUTH_SECRET: '', MAILPIT_URL: '', RESEND_API_KEY: '' });
    expect(config.authSecret).toBe('development-only-secret-not-for-production');
    expect(config.mail).toEqual({ from: 'Pennydrop <hello@pennydrop.test>' });
  });

  it('won’t start in production without a secret', () => {
    expect(() => configFromEnv({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
  });
});
