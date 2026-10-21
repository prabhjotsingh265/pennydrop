import { afterEach, describe, expect, it, vi } from 'vitest';
import { configFromEnv } from './config.ts';
import { createMailer } from './mail.ts';

const email = { to: 'p@example.com', subject: 'Hello', text: 'Hi there' };

afterEach(() => vi.unstubAllGlobals());

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

describe('createMailer', () => {
  it('sends through Mailpit locally, with the sender split into name and address', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await createMailer(configFromEnv({ MAILPIT_URL: 'http://mailpit:8025' }))(email);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://mailpit:8025/api/v1/send');
    expect(JSON.parse(init.body as string)).toEqual({
      From: { Email: 'hello@pennydrop.test', Name: 'Pennydrop' },
      To: [{ Email: 'p@example.com' }],
      Subject: 'Hello',
      Text: 'Hi there',
    });
  });

  it('prefers Resend when it has a key, and says when it was refused', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 422 }));
    vi.stubGlobal('fetch', fetch);
    const mailer = createMailer(
      configFromEnv({ RESEND_API_KEY: 're_test', MAILPIT_URL: 'http://mailpit:8025' }),
    );
    await expect(mailer(email)).rejects.toThrow('Resend refused the email (422).');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_test');
  });
});
