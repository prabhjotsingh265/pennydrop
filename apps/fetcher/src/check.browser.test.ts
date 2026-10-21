import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildShop } from '@pennydrop/shop/app';
import { SettingsStore } from '@pennydrop/shop/settings';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool } from './browser.ts';
import { createChecker } from './check.ts';

const NOW = Date.UTC(2026, 4, 12, 10);
const settings = new SettingsStore();
const guard = {
  allowPrivate: (host: string) => host.endsWith('.localhost'),
  resolveAs: (host: string) => (host.endsWith('.localhost') ? '127.0.0.1' : undefined),
};
const pool = new BrowserPool(guard);
const checker = createChecker({ userAgent: 'PennydropBot/test', guard, pool, now: () => NOW });
let server: Server;
let url = '';

beforeAll(async () => {
  settings.update('fickle', { latencyMs: [0, 0], layout: 'modern' });
  server = createServer(buildShop({ now: () => NOW, settings }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://fickle.localhost:${(server.address() as AddressInfo).port}/p/stoneware-mug`;
});

afterAll(async () => {
  await pool.close();
  server.closeAllConnections();
  server.close();
});

describe('checking with a browser', () => {
  it('moves on to a browser when the price isn’t in the HTML, and says so', async () => {
    const result = await checker.check({ url });
    expect(result).toMatchObject({ outcome: 'ok', mode: 'browser', neededBrowser: true });
    expect(result.extraction?.locator).toBe('[data-testid="price"]');
    expect(result.timings.http).toBeGreaterThan(0);
    expect(result.timings.browser).toBeGreaterThan(0);
  }, 60_000);

  it('previews a product for someone picking its price', async () => {
    const result = await checker.check({ url, forPeople: true });
    expect(result).toMatchObject({ outcome: 'ok', mode: 'browser' });
    expect(result.screenshot?.length).toBeGreaterThan(1000);
    expect(result.boxes.length).toBeGreaterThan(1);
  }, 60_000);
});
