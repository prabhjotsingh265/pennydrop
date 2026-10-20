import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildShop, type ShopOptions } from './app.ts';
import { findProduct } from './catalogue.ts';
import { DAY, OPENED, formatPence, quote } from './prices.ts';

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
