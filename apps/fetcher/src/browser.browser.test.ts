import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extract } from '@pennydrop/extract';
import { buildShop } from '@pennydrop/shop/app';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool, RenderError } from './browser.ts';

// The real practice shop, served in this process at a fixed moment.
const NOW = Date.UTC(2026, 4, 12, 10);
const UA = 'PennydropBot/test';
const servers: Server[] = [];
let shop = '';
let pages = '';
let pool: BrowserPool;

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

// Pages written for these tests: one that reaches for private addresses, one that never finishes.
const PAGES: Record<string, string> = {
  '/snoop':
    '<h1>Lamp</h1><p class="price">£40.00</p>' +
    '<img src="http://169.254.169.254/latest/meta-data/">' +
    '<script>fetch("http://10.0.0.5/admin").catch(() => {})</script>',
};

beforeAll(async () => {
  shop = `http://fickle.localhost:${await listen(createServer(buildShop({ now: () => NOW })))}`;
  pages = `http://localhost:${await listen(
    createServer((req, res) => {
      if (req.url === '/forever') return; // never answers
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(PAGES[req.url ?? ''] ?? '<p>Nothing</p>');
    }),
  )}`;
  await fetch(`${shop.replace('fickle.localhost', '127.0.0.1')}/_chaos/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ latencyMs: [0, 0], layout: 'modern', sale: 'off' }),
  });
  pool = new BrowserPool(
    {
      allowPrivate: (host) => host === 'localhost' || host.endsWith('.localhost'),
      resolveAs: (host) => (host.endsWith('.localhost') ? '127.0.0.1' : undefined),
    },
    3,
  );
}, 60_000);

afterAll(async () => {
  await pool.close();
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

describe('rendering in Chromium', () => {
  it('reads the price the modern layout loads with JavaScript', async () => {
    const page = await pool.render(`${shop}/p/stoneware-mug`, { userAgent: UA });
    const api = (await (
      await fetch(`${shop.replace('fickle.localhost', '127.0.0.1')}/api/price/stoneware-mug`)
    ).json()) as {
      price: string;
    };
    const result = extract({ html: page.html, boxes: page.boxes });
    expect(result.amount).toBe(Math.round(Number(api.price) * 100));
    expect(result.strategy).toBe('heuristic');
    expect(result.results.at(-1)?.candidates[0]?.note).toContain('the largest price on the page');
  }, 60_000);

  it('takes a picture for people to pick the price from', async () => {
    const page = await pool.render(`${shop}/p/stoneware-mug`, { userAgent: UA, forPeople: true });
    expect([...page.screenshot!.subarray(0, 2)]).toEqual([0xff, 0xd8]); // a JPEG
    expect(page.boxes.some((box) => box.visible && box.fontSize >= 30)).toBe(true);
  }, 60_000);

  it('stops the page reaching private addresses', async () => {
    const page = await pool.render(`${pages}/snoop`, { userAgent: UA, forPeople: true });
    expect(page.blocked).toBeGreaterThanOrEqual(2);
    expect(extract({ html: page.html }).amount).toBe(4000);
  }, 60_000);

  it('refuses to open a private address at all', async () => {
    for (const address of ['http://10.0.0.5/', 'https://10.0.0.5/']) {
      const error = await pool.render(address, { userAgent: UA }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).code).toBe('blocked-address');
    }
  }, 60_000);

  it('gives up on a page that never loads', async () => {
    const started = Date.now();
    const error = await pool
      .render(`${pages}/forever`, { userAgent: UA, navigationTimeoutMs: 1_500, deadlineMs: 3_000 })
      .catch((e: unknown) => e);
    expect((error as RenderError).code).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 60_000);

  it('restarts the browser every few pages', () => {
    // Three renders per browser; the tests above made more than that.
    expect(pool.launches).toBeGreaterThanOrEqual(2);
  });
});
