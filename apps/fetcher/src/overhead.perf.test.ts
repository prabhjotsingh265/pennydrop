import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Breaker,
  QUEUES,
  SiteGate,
  redisConnection,
  type FetchJob,
  type IngestJob,
} from '@pennydrop/queue';
import { buildShop } from '@pennydrop/shop/app';
import { SettingsStore } from '@pennydrop/shop/settings';
import { Queue, type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker } from './check.ts';
import { createFetchProcessor } from './worker.ts';

// The performance budget (make perf): our own overhead per HTTP check, apart from the site's
// time, under 100 ms for 95% of checks. The site's time is the fetch itself, as the check
// records it; everything else (robots.txt, the breaker, the site's gate, reading the price five
// ways, handing the report on) is ours.
const CHECKS = 100;

// A big shop page: a real product page (web-scraping.dev's), grown to about 1 MB the way shops'
// pages grow, with an app's data, a long menu and reviews, and no other prices.
const fixture = readFileSync(
  new URL('../../../packages/extract/fixtures/web-scraping-dev.html', import.meta.url),
  'utf8',
);
const words = 'soft sturdy handmade glaze colour gift kitchen daily favourite would buy again';
const bigPage = fixture.replace(
  '</body>',
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { reviews: Array.from({ length: 3800 }, (_, i) => ({ id: i, text: `${words} ${i}` })) },
  })}</script>
  <nav><ul>${Array.from({ length: 4500 }, (_, i) => `<li><a href="/c/${i}">Category ${i}</a></li>`).join('')}</ul></nav>
  <section>${Array.from({ length: 3800 }, (_, i) => `<p class="review">${words} (${i})</p>`).join('')}</section>
  </body>`,
);

const connection = redisConnection();
const prefix = `perf-${randomUUID()}`;
const settings = new SettingsStore();
const ingest = new Queue<IngestJob>(QUEUES.ingest, { connection, prefix });
let shop: Server;
let page: Server;
const ports = { shop: 0, page: 0 };

beforeAll(async () => {
  settings.update('fickle', { latencyMs: [0, 0] });
  shop = createServer(buildShop({ settings, random: () => 0.5 }));
  page = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(bigPage);
  });
  for (const [name, server] of [
    ['shop', shop],
    ['page', page],
  ] as const) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    ports[name] = (server.address() as AddressInfo).port;
  }
});
afterAll(async () => {
  for (const server of [shop, page]) {
    server.closeAllConnections();
    server.close();
  }
  await ingest.obliterate({ force: true });
  await ingest.close();
  const keys = await connection.keys(`${prefix}:*`);
  if (keys.length) await connection.del(...keys);
  await connection.quit();
});

const processor = createFetchProcessor({
  checker: createChecker({
    userAgent: 'PennydropBot/perf',
    guard: {
      allowPrivate: (host) => host.endsWith('.localhost'),
      resolveAs: (host) => (host.endsWith('.localhost') ? '127.0.0.1' : undefined),
    },
  }),
  gate: new SiteGate(connection, prefix),
  breaker: new Breaker(connection, prefix),
  ingest,
  lane: 'http',
  worker: 'perf',
});

function spread(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
}

async function measure(host: string, url: string) {
  const ours: number[] = [];
  const sites: number[] = [];
  for (let i = 0; i < CHECKS + 3; i++) {
    const id = `perf-${randomUUID()}`;
    const job: FetchJob = {
      targetId: randomUUID(),
      siteId: host,
      host,
      url,
      reason: 'scheduled',
      scheduledFor: Date.now(),
      mode: 'auto',
      recipe: null,
      etag: null,
      lastModified: null,
      // As the dispatcher sends it most of the time: the day's copy of robots.txt.
      robots: { status: 'ok', body: 'User-agent: *\nAllow: /', fetchedAt: Date.now() },
      gapMs: 0,
      maxInFlight: 5,
      currency: null,
    };
    const started = performance.now();
    const summary = await processor({ id, data: job } as Job<FetchJob>);
    const wall = performance.now() - started;
    expect(summary.outcome).toBe('ok');
    const report = (await ingest.getJob(id))!.data.report;
    if (i < 3) continue; // warmed up, as a running fetcher is
    sites.push(report.timings.http!);
    ours.push(wall - report.timings.http!);
  }
  return { ours: spread(ours), site: spread(sites) };
}

describe('our own time per HTTP check', () => {
  for (const kind of ['practice shop page', '1 MB shop page'] as const) {
    it(`stays under 100 ms for 95% of checks: ${kind}`, async () => {
      const big = kind === '1 MB shop page';
      const host = big ? 'big.localhost' : 'fickle.localhost';
      const url = big
        ? `http://${host}:${ports.page}/p/1`
        : `http://${host}:${ports.shop}/p/stoneware-mug`;
      const { ours, site } = await measure(host, url);
      if (big) expect(Buffer.byteLength(bigPage)).toBeGreaterThan(1_000_000);
      console.log(
        `${kind}: ours median ${ours.median.toFixed(1)} ms, 95th percentile ${ours.p95.toFixed(1)} ms ` +
          `(the site's own: median ${site.median.toFixed(1)} ms)`,
      );
      expect(ours.p95).toBeLessThan(100);
    }, 120_000);
  }
});
