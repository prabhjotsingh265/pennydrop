import { createHmac } from 'node:crypto';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShop, type ShopOptions } from './app.ts';
import { findProduct } from './catalogue.ts';
import { DAY, OPENED, formatPence, quote } from './prices.ts';
import { DEFAULTS, MAX_SANDBOXES, SANDBOX_KEEP_MS, SettingsStore, placeFor } from './settings.ts';

const NOW = OPENED + 120 * DAY + 3_600_000;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** Starts a shop on a free port; requests choose which shop with the Host header. */
async function start(options: ShopOptions = {}) {
  const app = buildShop({ now: () => NOW, random: () => 0.5, ...options });
  server = app.listen(0);
  await new Promise((resolve) => server!.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  return (
    path: string,
    init: { host?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const body = init.body === undefined ? undefined : JSON.stringify(init.body);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path,
          method: init.method ?? 'GET',
          headers: {
            host: `${init.host ?? 'fickle'}.localhost:${port}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...init.headers,
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
}

const fast = { latencyMs: [0, 0] };
const mug = findProduct('stoneware-mug')!;
const price = formatPence(quote(mug, NOW).price);

describe('the practice shop', () => {
  it('publishes a robots.txt per shop', async () => {
    const get = await start();
    const fickle = await get('/robots.txt');
    const slowpoke = await get('/robots.txt', { host: 'slowpoke' });
    expect(fickle.body).toContain('Crawl-delay: 1');
    expect(fickle.body).toContain('Disallow: /clearance/');
    expect(slowpoke.body).toContain('Crawl-delay: 5');
  });

  it('serves the classic layout with every kind of structured data', async () => {
    const get = await start();
    await get('/_chaos/state', { method: 'PUT', body: fast });
    const page = await get('/p/stoneware-mug');
    expect(page.status).toBe(200);
    expect(page.body).toContain(`<span class="price-now">${price}</span>`);
    expect(page.body).toContain('application/ld+json');
    expect(page.body).toContain('itemprop="price"');
    expect(page.body).toContain('property="product:price:amount"');
  });

  it('can switch off each kind of structured data', async () => {
    const get = await start();
    await get('/_chaos/state', {
      method: 'PUT',
      body: { ...fast, jsonLd: false, microdata: false },
    });
    const page = await get('/p/stoneware-mug');
    expect(page.body).not.toContain('application/ld+json');
    expect(page.body).not.toContain('itemprop="price"');
    expect(page.body).toContain('property="product:price:amount"');
  });

  it('moves and renames the price in the redesign, with no structured data', async () => {
    const get = await start();
    await get('/_chaos/state', { method: 'PUT', body: { ...fast, layout: 'redesign' } });
    const page = await get('/p/stoneware-mug');
    expect(page.body).toMatch(new RegExp(`data-price>\\s*${price.replace('.', '\\.')}\\s*</div>`));
    expect(page.body).not.toContain('price-now');
    expect(page.body).not.toContain('application/ld+json');
  });

  it('leaves the price out of the modern layout and serves it to its script', async () => {
    const get = await start();
    await get('/_chaos/state', { method: 'PUT', body: { ...fast, layout: 'modern' } });
    const page = await get('/p/stoneware-mug');
    expect(page.body).toContain('data-testid="price"></div>');
    expect(page.body).toMatch(/class="css-[a-z0-9]{6}"/);
    const api = JSON.parse((await get('/api/price/stoneware-mug')).body);
    expect(api.display).toBe(price);
  });

  it('keeps each shop’s settings separate', async () => {
    const get = await start();
    await get('/_chaos/state', { method: 'PUT', body: { ...fast, layout: 'redesign' } });
    const brittle = JSON.parse((await get('/_chaos/state', { host: 'brittle' })).body);
    expect(brittle.layout).toBe('classic');
  });

  it('answers 304 to a repeat request whose page has not changed', async () => {
    const get = await start();
    await get('/_chaos/state', { method: 'PUT', body: fast });
    const first = await get('/p/stoneware-mug');
    const again = await get('/p/stoneware-mug', {
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    expect(again.status).toBe(304);
  });

  it('fails on purpose as the settings say', async () => {
    const get = await start();
    const as = async (patch: object) => {
      await get('/_chaos/state', {
        host: 'brittle',
        method: 'PUT',
        body: { ...fast, errorRate: 0, rateLimitRate: 0, blockRate: 0, ...patch },
      });
      return get('/p/stoneware-mug', { host: 'brittle' });
    };
    expect((await as({ errorRate: 1 })).status).toBe(500);
    const limited = await as({ rateLimitRate: 1 });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('30');
    const blocked = await as({ blockRate: 1 });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toContain('Access denied');
  });

  it('refuses settings that make no sense', async () => {
    const get = await start();
    const reply = await get('/_chaos/state', { method: 'PUT', body: { layout: 'brutalist' } });
    expect(reply.status).toBe(422);
    const unknown = await get('/_chaos/state', { method: 'PUT', body: { colour: 'red' } });
    expect(unknown.status).toBe(422);
  });

  it('hides the chaos controls without the token, once one is set', async () => {
    const get = await start({ chaosToken: 'open-sesame' });
    expect((await get('/_chaos/state')).status).toBe(404);
    expect(
      (await get('/_chaos/state', { headers: { 'x-chaos-token': 'open-sesame' } })).status,
    ).toBe(200);
  });

  it('lists clearance products only under /clearance/', async () => {
    const get = await start();
    await get('/_chaos/state', { method: 'PUT', body: fast });
    expect((await get('/clearance/taper-candles')).status).toBe(200);
    expect((await get('/p/taper-candles')).status).toBe(404);
  });

  it('draws a picture for each product', async () => {
    const get = await start();
    const art = await get('/art/stoneware-mug.svg');
    expect(art.headers['content-type']).toContain('image/svg+xml');
    expect(art.body).toContain('<svg');
  });
});

describe('sandboxes', () => {
  it('serves a private copy of Fickle at sandbox-<token> hosts, with its own chaos', async () => {
    const get = await start();
    const mine = 'sandbox-a1b2c3d4';
    const page = await get('/p/stoneware-mug', { host: mine });
    expect(page.body).toContain(`<span class="price-now">${price}</span>`);
    await get('/_chaos/state', {
      host: mine,
      method: 'PUT',
      body: { ...fast, layout: 'redesign' },
    });
    expect((await get('/p/stoneware-mug', { host: mine })).body).not.toContain('price-now');
    // Fickle itself and every other sandbox are untouched.
    expect((await get('/p/stoneware-mug')).body).toContain('price-now');
    expect((await get('/p/stoneware-mug', { host: 'sandbox-e5f6a7b8' })).body).toContain(
      'price-now',
    );
    await get('/_chaos/reset', { host: mine, method: 'POST' });
    expect((await get('/p/stoneware-mug', { host: mine })).body).toContain('price-now');
  });

  it('knows a sandbox by its host, and anything else as one of the three shops', () => {
    expect(placeFor('sandbox-a1b2c3d4.localhost')).toEqual({ shop: 'fickle', sandbox: 'a1b2c3d4' });
    expect(placeFor('brittle.localhost')).toEqual({ shop: 'brittle', sandbox: null });
    // Too short to be one of ours.
    expect(placeFor('sandbox-x.localhost')).toEqual({ shop: 'fickle', sandbox: null });
  });

  it('forgets a sandbox untouched for two days, and keeps no more than the cap', () => {
    let now = 0;
    const store = new SettingsStore(() => now);
    const sandbox = (token: string) => ({ shop: 'fickle' as const, sandbox: token });
    store.update(sandbox('old'), { stock: 'out' });
    now = SANDBOX_KEEP_MS + 1;
    store.update(sandbox('new'), { stock: 'out' });
    expect(store.get(sandbox('old')).stock).toBe('auto');
    expect(store.get(sandbox('new')).stock).toBe('out');
    // The three shops are never forgotten.
    store.update('fickle', { stock: 'out' });
    for (let i = 0; i < MAX_SANDBOXES + 5; i++) store.update(sandbox(`s${i}`), { sale: 'on' });
    expect(store.sandboxes).toBe(MAX_SANDBOXES);
    expect(store.get(sandbox('s0')).sale).toBe('auto');
    expect(store.get('fickle').stock).toBe('out');
  });
});

describe('replays', () => {
  const SECRET = 'test-replay-secret';
  const signed = (at: number) => ({
    'pennydrop-replay-at': String(at),
    'pennydrop-replay-signature': createHmac('sha256', SECRET).update(`replay:${at}`).digest('hex'),
  });
  // A moment when the mug's price differed from now, so the page can only be the past one.
  const mug = findProduct('stoneware-mug')!;
  const then = Array.from({ length: 100 }, (_, i) => NOW - (i + 1) * DAY).find(
    (t) => quote(mug, t, DEFAULTS.fickle).price !== quote(mug, NOW, DEFAULTS.fickle).price,
  )!;

  it('serves the page as it stood at a signed moment', async () => {
    const get = await start({ replaySecret: SECRET });
    const page = await get('/p/stoneware-mug', { headers: signed(then) });
    expect(page.status).toBe(200);
    expect(page.body).toContain(
      `<span class="price-now">${formatPence(quote(mug, then, DEFAULTS.fickle).price)}</span>`,
    );
  });

  it('shows the past in the shop’s usual layout, without today’s chaos or failures', async () => {
    const get = await start({ replaySecret: SECRET, random: () => 0 });
    await get('/_chaos/state', { method: 'PUT', body: { ...fast, layout: 'redesign' } });
    expect((await get('/p/stoneware-mug', { headers: signed(then) })).body).toContain('price-now');
    // Brittle fails 30% of visits, and this "roll" would be one of them; a replay isn't a visit.
    expect((await get('/p/stoneware-mug', { host: 'brittle' })).status).toBe(500);
    expect((await get('/p/stoneware-mug', { host: 'brittle', headers: signed(then) })).status).toBe(
      200,
    );
  });

  it('refuses an unsigned, forged or impossible replay, rather than answer with today', async () => {
    const get = await start({ replaySecret: SECRET });
    const forged = { ...signed(then), 'pennydrop-replay-at': String(then - DAY) };
    expect((await get('/p/stoneware-mug', { headers: forged })).status).toBe(403);
    expect(
      (await get('/p/stoneware-mug', { headers: { 'pennydrop-replay-at': String(then) } })).status,
    ).toBe(403);
    expect((await get('/p/stoneware-mug', { headers: signed(OPENED - DAY) })).status).toBe(422);
    expect((await get('/p/stoneware-mug', { headers: signed(NOW + DAY) })).status).toBe(422);
    // A shop that shares no secret takes no replays at all.
    expect((await (await start())('/p/stoneware-mug', { headers: signed(then) })).status).toBe(403);
  });
});

describe('the message catcher', () => {
  it('keeps what’s posted to it, newest first, and fails on request', async () => {
    const get = await start();
    expect(
      (
        await get('/_hooks/slack', {
          method: 'POST',
          body: { text: 'first' },
          headers: { 'pennydrop-delivery': 'd1' },
        })
      ).status,
    ).toBe(200);
    await get('/_hooks/slack', { method: 'POST', body: { text: 'second' } });
    expect(
      (await get('/_hooks/discord?status=503', { method: 'POST', body: { embeds: [] } })).status,
    ).toBe(503);

    expect(JSON.parse((await get('/_hooks')).body)).toEqual({ slack: 2, discord: 1 });
    const slack = JSON.parse((await get('/_hooks/slack')).body);
    expect(slack.map((m: { body: { text: string } }) => m.body.text)).toEqual(['second', 'first']);
    expect(slack[1].headers['pennydrop-delivery']).toBe('d1');
  });

  it('is hidden behind the chaos token, once one is set', async () => {
    const get = await start({ chaosToken: 'open-sesame' });
    expect((await get('/_hooks')).status).toBe(404);
    expect((await get('/_hooks', { headers: { 'x-hooks-token': 'open-sesame' } })).status).toBe(
      200,
    );
  });
});
