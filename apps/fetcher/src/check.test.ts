import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildShop } from '@pennydrop/shop/app';
import { SettingsStore } from '@pennydrop/shop/settings';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createChecker, retryAfter } from './check.ts';

const NOW = Date.UTC(2026, 4, 12, 10);
const settings = new SettingsStore();
const servers: Server[] = [];
let port = 0;

async function listen(handler: RequestListener): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

beforeAll(async () => {
  port = await listen(buildShop({ now: () => NOW, settings, random: () => 0.5 }));
});

afterEach(() => {
  for (const shop of ['fickle', 'slowpoke', 'brittle'] as const) settings.reset(shop);
  for (const shop of ['fickle', 'slowpoke', 'brittle'] as const)
    settings.update(shop, { latencyMs: [0, 0] });
});

afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

const checker = createChecker({
  userAgent: 'PennydropBot/test',
  guard: {
    allowPrivate: (host) => host === 'localhost' || host.endsWith('.localhost'),
    resolveAs: (host) => (host.endsWith('.localhost') ? '127.0.0.1' : undefined),
  },
  http: { headersTimeoutMs: 1_000 },
  now: () => NOW,
});

const at = (shop: string, path: string) => `http://${shop}.localhost:${port}${path}`;
const shopPrice = async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/price/stoneware-mug`);
  return Math.round(Number(((await response.json()) as { price: string }).price) * 100);
};

describe('checking a product', () => {
  it('reads a classic page with plain HTTP', async () => {
    const result = await checker.check({ url: at('fickle', '/p/stoneware-mug') });
    expect(result).toMatchObject({
      outcome: 'ok',
      mode: 'http',
      status: 200,
      neededBrowser: false,
      crawlDelay: 1,
    });
    expect(result.extraction?.amount).toBe(await shopPrice());
    expect(result.etag).toBeTruthy();
  });

  it('asks whether the page changed, and takes "no" for an answer', async () => {
    const first = await checker.check({ url: at('fickle', '/p/stoneware-mug') });
    const again = await checker.check({
      url: at('fickle', '/p/stoneware-mug'),
      etag: first.etag,
      robots: first.robots,
    });
    expect(again.outcome).toBe('unchanged');
  });

  it('won’t visit a page robots.txt rules out', async () => {
    expect((await checker.check({ url: at('fickle', '/clearance/taper-candles') })).outcome).toBe(
      'robots_disallowed',
    );
  });

  it('treats a missing robots.txt as allowed and an unreachable one as not', async () => {
    const page = '<h1>Lamp</h1><p class="price">£40.00</p><button>Add to basket</button>';
    const missing = await listen((req, res) =>
      req.url === '/robots.txt'
        ? void res.writeHead(404).end()
        : void res.writeHead(200, { 'content-type': 'text/html' }).end(page),
    );
    const down = await listen((req, res) =>
      req.url === '/robots.txt'
        ? void res.writeHead(503).end()
        : void res.writeHead(200, { 'content-type': 'text/html' }).end(page),
    );
    expect((await checker.check({ url: `http://localhost:${missing}/lamp` })).outcome).toBe('ok');
    expect((await checker.check({ url: `http://localhost:${down}/lamp` })).outcome).toBe(
      'robots_disallowed',
    );
  });

  it('hears "slow down", "go away" and "broken" for what they are', async () => {
    settings.update('brittle', { rateLimitRate: 1, errorRate: 0, blockRate: 0 });
    const limited = await checker.check({ url: at('brittle', '/p/stoneware-mug') });
    expect(limited).toMatchObject({ outcome: 'rate_limited', retryAfterSeconds: 30 });

    settings.update('brittle', { rateLimitRate: 0, blockRate: 1 });
    expect((await checker.check({ url: at('brittle', '/p/stoneware-mug') })).outcome).toBe(
      'blocked',
    );

    settings.update('brittle', { blockRate: 0, errorRate: 1 });
    expect((await checker.check({ url: at('brittle', '/p/stoneware-mug') })).outcome).toBe(
      'http_error',
    );
  });

  it('knows a product that has gone', async () => {
    expect((await checker.check({ url: at('fickle', '/p/discontinued-thing') })).outcome).toBe(
      'gone',
    );
  });

  it('gives up on a shop that’s too slow', async () => {
    settings.update('slowpoke', { latencyMs: [3_000, 3_000] });
    expect((await checker.check({ url: at('slowpoke', '/p/stoneware-mug') })).outcome).toBe(
      'timeout',
    );
  });

  it('reports the price missing, without a browser, when the page writes it with JavaScript', async () => {
    settings.update('fickle', { layout: 'modern' });
    const result = await checker.check({ url: at('fickle', '/p/stoneware-mug') });
    expect(result.outcome).toBe('price_not_found');
  });

  it('recognises a "prove you’re human" page served as a 200', async () => {
    const wall = await listen((req, res) =>
      req.url === '/robots.txt'
        ? void res.writeHead(404).end()
        : void res
            .writeHead(200, { 'content-type': 'text/html' })
            .end('<h1>Checking your browser</h1><p>Please complete the CAPTCHA to continue.</p>'),
    );
    expect((await checker.check({ url: `http://localhost:${wall}/lamp` })).outcome).toBe('blocked');
  });

  it('refuses private addresses before anything else', async () => {
    const strict = createChecker({ userAgent: 'PennydropBot/test', guard: {} });
    expect((await strict.check({ url: 'http://169.254.169.254/latest/meta-data/' })).outcome).toBe(
      'blocked_address',
    );
  });
});

describe('retryAfter', () => {
  it('reads seconds or a date, and caps at a day', () => {
    expect(retryAfter('30', NOW)).toBe(30);
    expect(retryAfter(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90);
    expect(retryAfter('999999', NOW)).toBe(86_400);
    expect(retryAfter('soon', NOW)).toBeNull();
    expect(retryAfter(undefined, NOW)).toBeNull();
  });
});
