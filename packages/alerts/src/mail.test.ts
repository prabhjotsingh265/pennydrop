import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailer } from './mail.ts';

const email = { to: 'p@example.com', subject: 'Hello', text: 'Hi there' };
const settings = { from: 'Pennydrop <hello@pennydrop.test>' };

afterEach(() => vi.unstubAllGlobals());

describe('createMailer', () => {
  it('sends through Mailpit locally, with the sender split into name and address', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await createMailer({ ...settings, mailpitUrl: 'http://mailpit:8025' })(email);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://mailpit:8025/api/v1/send');
    expect(JSON.parse(init.body as string)).toEqual({
      From: { Email: 'hello@pennydrop.test', Name: 'Pennydrop' },
      To: [{ Email: 'p@example.com' }],
      Subject: 'Hello',
      Text: 'Hi there',
    });
  });

  it('sends the HTML beside the text', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await createMailer({ ...settings, mailpitUrl: 'http://mailpit:8025' })({
      ...email,
      html: '<p>Hi there</p>',
    });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      Text: 'Hi there',
      HTML: '<p>Hi there</p>',
    });
  });

  it('prefers Resend when it has a key, and says when it was refused', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 422 }));
    vi.stubGlobal('fetch', fetch);
    const mailer = createMailer({
      ...settings,
      resendKey: 're_test',
      mailpitUrl: 'http://mailpit:8025',
    });
    await expect(mailer(email)).rejects.toThrow('Resend refused the email (422).');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_test');
  });
});
