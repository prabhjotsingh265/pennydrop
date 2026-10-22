import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { settingsFor } from './channels.ts';
import { verify } from './crypto.ts';
import { compose } from './messages.ts';
import { send } from './send.ts';

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}
const received: Received[] = [];
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body });
      const status = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('status') ?? 200);
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const message = compose({
  alertId: 'a1',
  label: 'Copper kettle',
  host: 'fickle.example.com',
  url: 'https://fickle.example.com/p/kettle',
  link: 'https://pennydrop.example.com/app/p/w1',
  price: 5199,
  currency: 'GBP',
  kinds: ['below_target'],
  reasons: ['At or below your £55.00 target'],
  firedAt: '2026-10-22T12:00:00.000Z',
});
// The test server is on this machine: trusted here, as the practice shop is in development.
const deps = {
  mail: vi.fn(async () => {}),
  guard: { allowPrivate: (host: string) => host === '127.0.0.1' },
  userAgent: 'PennydropBot/test',
  timeoutMs: 2_000,
};

describe('send', () => {
  it('signs a webhook and names the delivery, so the receiver can check and de-duplicate it', async () => {
    const secret = 'whsec_test';
    const result = await send(
      { kind: 'webhook', url: `${base}/hook`, secret },
      message,
      'd1',
      deps,
    );
    expect(result).toEqual({ ok: true });
    const got = received.at(-1)!;
    expect(got.headers['pennydrop-delivery']).toBe('d1');
    expect(verify(String(got.headers['pennydrop-signature']), got.body, secret, Date.now())).toBe(
      true,
    );
    expect(JSON.parse(got.body)).toMatchObject({
      type: 'price.alert',
      deliveryId: 'd1',
      price: { amount: 5199 },
    });
  });

  it('sends Slack and Discord their own formats', async () => {
    await send({ kind: 'slack', url: `${base}/slack` }, message, 'd2', deps);
    expect(JSON.parse(received.at(-1)!.body).text).toContain(
      '*<https://pennydrop.example.com/app/p/w1|Copper kettle: £51.99>*',
    );
    await send({ kind: 'discord', url: `${base}/discord` }, message, 'd3', deps);
    expect(JSON.parse(received.at(-1)!.body).embeds[0]).toMatchObject({
      title: 'Copper kettle: £51.99',
      color: 0xd77f3d,
    });
  });

  it('gives up for good on a revoked webhook, and retries a broken one', async () => {
    expect(
      await send({ kind: 'slack', url: `${base}/gone?status=404` }, message, 'd4', deps),
    ).toMatchObject({
      ok: false,
      permanent: true,
    });
    expect(
      await send({ kind: 'slack', url: `${base}/busy?status=503` }, message, 'd5', deps),
    ).toMatchObject({
      ok: false,
      permanent: false,
    });
    expect(
      await send({ kind: 'slack', url: `${base}/slow?status=429` }, message, 'd6', deps),
    ).toMatchObject({
      permanent: false,
    });
  });

  it('never reaches a private network', async () => {
    const result = await send(
      { kind: 'webhook', url: `${base}/hook`, secret: 's' },
      message,
      'd7',
      {
        ...deps,
        guard: {},
      },
    );
    expect(result).toEqual({
      ok: false,
      permanent: true,
      error: expect.stringMatching(/private network|Port/),
    });
  });

  it('sends email through the mailer', async () => {
    expect(await send({ kind: 'email', address: 'p@example.com' }, message, 'd8', deps)).toEqual({
      ok: true,
    });
    expect(deps.mail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'p@example.com',
        subject: expect.stringContaining('Copper kettle: £51.99'),
      }),
    );
  });
});

describe('settingsFor', () => {
  it('takes only real Slack and Discord addresses, and HTTPS webhooks', () => {
    const at = (kind: 'slack' | 'discord' | 'webhook', url: string) =>
      settingsFor({ kind, name: 'x', url }, { local: false });
    // Placeholders, not secrets: real webhook addresses only ever live in .env (a hook refuses them here).
    expect(at('slack', 'https://hooks.slack.com/services/example/channel/token').ok).toBe(true);
    expect(at('slack', 'https://evil.example.com/services/T000').ok).toBe(false);
    const fakeId = String(1_000);
    expect(at('discord', `https://discord.com/api/webhooks/${fakeId}/example-token`).ok).toBe(true);
    expect(at('discord', 'https://discord.com/other').ok).toBe(false);
    expect(at('webhook', 'http://receiver.example.com/hook').ok).toBe(false);
    const webhook = at('webhook', 'https://receiver.example.com/hook');
    expect(webhook.ok && webhook.settings.kind === 'webhook' && webhook.settings.secret).toMatch(
      /^whsec_/,
    );
  });

  it('lets the practice shop’s catcher stand in, locally only', () => {
    const catcher = {
      kind: 'slack' as const,
      name: 'x',
      url: 'http://hooks.localhost:4000/_hooks/slack',
    };
    expect(settingsFor(catcher, { local: true }).ok).toBe(true);
    expect(settingsFor(catcher, { local: false }).ok).toBe(false);
  });
});
