import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Breaker,
  QUEUES,
  SiteGate,
  redisConnection,
  type CheckReport,
  type FetchJob,
  type IngestJob,
} from '@pennydrop/queue';
import { buildShop } from '@pennydrop/shop/app';
import { SettingsStore } from '@pennydrop/shop/settings';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker } from './check.ts';
import { createFetchProcessor } from './worker.ts';

/**
 * The README's proof: one site that hangs and one that fails every time must
 * not slow down a healthy one. Fickle's 30 checks are timed alone, then again
 * mixed in with 30 checks of each bad site, all on six shared workers.
 */

const connection = redisConnection();
const settings = new SettingsStore();
let server: Server;
let port = 0;

beforeAll(async () => {
  settings.update('fickle', { latencyMs: [20, 20] });
  settings.update('slowpoke', { latencyMs: [60_000, 60_000] }); // hangs well past the 2 s timeout
  settings.update('brittle', { latencyMs: [0, 0], errorRate: 1, rateLimitRate: 0, blockRate: 0 }); // fails every time
  server = createServer(buildShop({ settings, random: () => 0.5 }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await connection.quit();
});

interface Run {
  /** Milliseconds from the start until each site's last report. */
  finished: Record<string, number>;
  reports: CheckReport[];
}

async function run(sites: string[], perSite: number): Promise<Run> {
  const prefix = `test-${randomUUID()}`;
  const fetches = new Queue<FetchJob>(QUEUES.fetchHttp, { connection, prefix });
  const ingest = new Queue<IngestJob>(QUEUES.ingest, { connection, prefix });
  const checker = createChecker({
    userAgent: 'PennydropBot/test',
    guard: {
      allowPrivate: (host) => host.endsWith('.localhost'),
      resolveAs: (host) => (host.endsWith('.localhost') ? '127.0.0.1' : undefined),
    },
    http: { headersTimeoutMs: 2_000 },
  });
  const processor = createFetchProcessor({
    checker,
    gate: new SiteGate(connection, prefix),
    breaker: new Breaker(connection, prefix, [60_000]),
    ingest,
    lane: 'http',
    worker: 'test',
  });

  const started = Date.now();
  // Interleaved, as a real queue would be: fickle, slowpoke, brittle, fickle, …
  const jobs = Array.from({ length: perSite }, (_, i) =>
    sites.map((site) => ({
      name: 'check',
      data: {
        targetId: `${site}-${i}`,
        siteId: site,
        host: `${site}.localhost`,
        url: `http://${site}.localhost:${port}/p/stoneware-mug`,
        reason: 'scheduled' as const,
        scheduledFor: started,
        mode: 'auto' as const,
        recipe: null,
        etag: null,
        lastModified: null,
        robots: null,
        // Polite pacing per site: 100 ms apart, two at a time.
        gapMs: 100,
        maxInFlight: 2,
        currency: null,
      },
      opts: { jobId: `${site}-${i}` },
    })),
  ).flat();
  await fetches.addBulk(jobs);
  const worker = new Worker(QUEUES.fetchHttp, processor, { connection, prefix, concurrency: 6 });

  let reports: CheckReport[] = [];
  while (reports.length < jobs.length && Date.now() - started < 60_000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    reports = (await ingest.getJobs(['waiting'])).map((job) => job.data.report);
  }
  await worker.close();
  for (const queue of [fetches, ingest]) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  const keys = await connection.keys(`${prefix}:*`);
  if (keys.length) await connection.del(...keys);

  const finished: Record<string, number> = {};
  for (const report of reports) {
    const site = new URL(report.url).hostname.split('.')[0]!;
    finished[site] = Math.max(finished[site] ?? 0, report.finishedAt - started);
  }
  return { finished, reports };
}

const count = (reports: CheckReport[], site: string, outcome?: string) =>
  reports.filter((r) => r.url.includes(`//${site}.`) && (!outcome || r.outcome === outcome)).length;

describe('the noisy neighbour', () => {
  it('lets a healthy site finish on time while one site hangs and another fails', async () => {
    const alone = await run(['fickle'], 30);
    const mixed = await run(['fickle', 'slowpoke', 'brittle'], 30);

    const aloneMs = alone.finished.fickle!;
    const mixedMs = mixed.finished.fickle!;
    console.log(
      [
        `fickle alone: 30 checks in ${(aloneMs / 1000).toFixed(2)} s`,
        `fickle beside a hanging and a failing site: 30 checks in ${(mixedMs / 1000).toFixed(2)} s`,
        `slowpoke: ${count(mixed.reports, 'slowpoke', 'timeout')} timed out, ${count(mixed.reports, 'slowpoke', 'skipped_breaker_open')} skipped by its breaker`,
        `brittle: ${count(mixed.reports, 'brittle', 'http_error')} failed, ${count(mixed.reports, 'brittle', 'skipped_breaker_open')} skipped by its breaker`,
      ].join('\n'),
    );

    // Every fickle check succeeded, and took barely longer than it did alone.
    expect(count(mixed.reports, 'fickle', 'ok')).toBe(30);
    // (Left unguarded, 30 checks hanging for 2 s each would hold the workers for 10 s or more.)
    expect(mixedMs).toBeLessThan(aloneMs * 1.5 + 1_000);

    // Each bad site was tried a handful of times, then left alone by its breaker.
    expect(count(mixed.reports, 'slowpoke', 'timeout')).toBeLessThanOrEqual(7);
    expect(count(mixed.reports, 'brittle', 'http_error')).toBeLessThanOrEqual(7);
    expect(count(mixed.reports, 'slowpoke', 'skipped_breaker_open')).toBeGreaterThanOrEqual(23);
    expect(count(mixed.reports, 'brittle', 'skipped_breaker_open')).toBeGreaterThanOrEqual(23);
  }, 120_000);
});
