import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extract, loadPage } from '@pennydrop/extract';
import { buildShop } from '@pennydrop/shop/app';
import { SettingsStore } from '@pennydrop/shop/settings';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool } from './browser.ts';
import { createChecker } from './check.ts';
import { choicesFrom, titleFrom } from './preview.ts';

const NOW = Date.UTC(2026, 4, 12, 10);
const settings = new SettingsStore();
const guard = {
  allowPrivate: (host: string) => host.endsWith('.localhost'),
  resolveAs: (host: string) => (host.endsWith('.localhost') ? '127.0.0.1' : undefined),
};
const pool = new BrowserPool(guard);
const checker = createChecker({ userAgent: 'PennydropBot/test', guard, pool, now: () => NOW });
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer(buildShop({ now: () => NOW, settings }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await pool.close();
  server.closeAllConnections();
  server.close();
});

async function preview(layout: 'classic' | 'modern') {
  settings.update('fickle', { latencyMs: [0, 0], layout });
  const result = await checker.check({
    url: `http://fickle.localhost:${port}/p/stoneware-mug`,
    forPeople: true,
  });
  const { choices, selectors } = choicesFrom(
    result.html!,
    result.boxes,
    result.extraction,
    result.screenshotHeight,
  );
  return { result, choices, selectors, plain: extract({ html: result.source ?? '' }) };
}

describe('previewing a real page', () => {
  it('boxes the prices, picks the product’s own, and finds it in the page as served', async () => {
    const { result, choices, selectors, plain } = await preview('classic');
    expect(result.outcome).toBe('ok');
    expect(titleFrom(result.html!)).toBe('Stoneware mug, speckled');
    const best = choices.filter((c) => c.best);
    expect(best).toHaveLength(1);
    expect(best[0]!.amount).toBe(result.extraction!.amount);
    // Related products' prices are offered too, for when the pick is wrong.
    expect(choices.length).toBeGreaterThan(1);
    // Every selector finds an element in the rendered page.
    const page = loadPage(result.html!);
    for (const selector of selectors) expect(page.$(selector).length).toBeGreaterThan(0);
    expect(plain.amount).toBe(result.extraction!.amount);
  }, 60_000);

  it('notices when only the browser can see the price', async () => {
    const { result, choices, plain } = await preview('modern');
    expect(result.outcome).toBe('ok');
    expect(choices.some((c) => c.best && c.amount === result.extraction!.amount)).toBe(true);
    expect(plain.amount).toBeNull();
  }, 60_000);
});
