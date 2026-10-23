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
import { findProduct } from '@pennydrop/shop/catalogue';
import { DAY, quote } from '@pennydrop/shop/prices';
import { DEFAULTS, SettingsStore } from '@pennydrop/shop/settings';
import { Queue, Worker, type Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createChecker } from './check.ts';
import { createFetchProcessor } from './worker.ts';

const connection = redisConnection();
const settings = new SettingsStore();
const REPLAY_SECRET = 'test-replay-secret';
let server: Server;
let port = 0;
let prefix = '';
let fetches: Queue<FetchJob>;
let ingest: Queue<IngestJob>;
let worker: Worker<FetchJob>;
let gate: SiteGate;
let breaker: Breaker;

beforeAll(async () => {
  server = createServer(buildShop({ settings, random: () => 0.5, replaySecret: REPLAY_SECRET }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

beforeEach(() => {
  for (const shop of ['fickle', 'brittle'] as const) settings.reset(shop);
  for (const shop of ['fickle', 'brittle'] as const) settings.update(shop, { latencyMs: [0, 0] });
  prefix = `test-${randomUUID()}`;
  fetches = new Queue(QUEUES.fetchHttp, { connection, prefix });
  ingest = new Queue(QUEUES.ingest, { connection, prefix });
  gate = new SiteGate(connection, prefix);
  breaker = new Breaker(connection, prefix, [60_000]);
  const checker = createChecker({
    userAgent: 'PennydropBot/test',
    guard: {
      allowPrivate: (host) => host.endsWith('.localhost'),
      resolveAs: (host) => (host.endsWith('.localhost') ? '127.0.0.1' : undefined),
    },
    http: { headersTimeoutMs: 1_000 },
  });
  const processor = createFetchProcessor({
    checker,
    gate,
    breaker,
    ingest,
    lane: 'http',
    worker: 'test',
    replaySecret: REPLAY_SECRET,
  });
  worker = new Worker(QUEUES.fetchHttp, processor, { connection, prefix, concurrency: 5 });
});

afterEach(async () => {
  await worker.close();
  for (const queue of [fetches, ingest]) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  const keys = await connection.keys(`${prefix}:*`);
  if (keys.length) await connection.del(...keys);
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await connection.quit();
});

let serial = 0;
function job(shop: string, path = '/p/stoneware-mug', extra: Partial<FetchJob> = {}): FetchJob {
  return {
    targetId: `t${++serial}`,
    siteId: shop,
    host: `${shop}.localhost`,
    url: `http://${shop}.localhost:${port}${path}`,
    reason: 'scheduled',
    scheduledFor: Date.now(),
    mode: 'auto',
    recipe: null,
    etag: null,
    lastModified: null,
    robots: null,
    gapMs: 0,
    maxInFlight: 5,
    currency: null,
    ...extra,
  };
}

async function reports(count: number, timeoutMs = 10_000): Promise<CheckReport[]> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const jobs = await ingest.getJobs(['waiting']);
    if (jobs.length >= count)
      return jobs.map((j) => j.data.report).sort((a, b) => a.finishedAt - b.finishedAt);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Expected ${count} reports, got ${(await ingest.getJobs(['waiting'])).length}.`);
}

describe('replays', () => {
  const mug = findProduct('stoneware-mug')!;

  it('reads the page as it stood at the past moment asked for', async () => {
    // A moment when the mug cost something other than now, so only the past page has that price.
    const now = Date.now();
    const then = Array.from({ length: 60 }, (_, i) => now - (i + 1) * DAY).find(
      (t) => quote(mug, t, DEFAULTS.fickle).price !== quote(mug, now, DEFAULTS.fickle).price,
    )!;
    // Today's shop is redesigned; the past one wasn't.
    settings.update('fickle', { layout: 'redesign' });
    await fetches.add(
      'check',
      job('fickle', '/p/stoneware-mug', { reason: 'replay', scheduledFor: then }),
      { jobId: 'replay-mug' },
    );
    const [report] = await reports(1);
    expect(report).toMatchObject({
      outcome: 'ok',
      amount: quote(mug, then, DEFAULTS.fickle).price,
    });
  });

  it('neither asks the breaker nor tells it: a replay says nothing of the live site’s health', async () => {
    for (let i = 0; i < 5; i++) await breaker.report('brittle.localhost', false);
    const before = await breaker.state('brittle.localhost');
    expect(before.state).toBe('open');
    await fetches.add(
      'check',
      job('brittle', '/p/stoneware-mug', { reason: 'replay', scheduledFor: Date.now() - DAY }),
      { jobId: 'replay-brittle' },
    );
    const [report] = await reports(1);
    expect(report).toMatchObject({ outcome: 'ok', breaker: { change: null } });
    expect(await breaker.state('brittle.localhost')).toEqual(before);
  });

  it('fails a replay it can’t sign, rather than fetch today’s page', async () => {
    const unsigned = createFetchProcessor({
      checker: createChecker({ userAgent: 'PennydropBot/test', guard: {} }),
      gate,
      breaker,
      ingest,
      lane: 'http',
      worker: 'test',
    });
    const data = job('fickle', '/p/stoneware-mug', {
      reason: 'replay',
      scheduledFor: Date.now() - DAY,
    });
    // What the logs are told, too.
    expect(await unsigned({ id: 'replay-unsigned', data } as Job<FetchJob>)).toEqual({
      outcome: 'http_error',
      ms: 0,
      strategy: null,
      breaker: null,
    });
    const [report] = await reports(1);
    expect(report).toMatchObject({ outcome: 'http_error', amount: null });
    expect(report!.detail).toContain('REPLAY_SECRET');
  });
});

describe('the fetch worker', () => {
  it('checks a product and hands the result to ingest, under the same job id', async () => {
    const added = await fetches.add('check', job('fickle'), { jobId: 'check-1' });
    const [report] = await reports(1);
    expect(report).toMatchObject({
      outcome: 'ok',
      mode: 'http',
      worker: 'test',
      breaker: { change: null },
    });
    expect(report!.amount).toBeGreaterThan(0);
    expect((await ingest.getJob(added.id!))?.data.checkJobId).toBe('check-1');
    // The gate slot was handed back.
    expect(
      await gate.acquire('fickle.localhost', { gapMs: 0, maxInFlight: 1, leaseMs: 1_000 }, 'next'),
    ).toBe(0);
  });

  it('puts the job back, rather than waiting, while the site is busy', async () => {
    await gate.acquire(
      'fickle.localhost',
      { gapMs: 0, maxInFlight: 1, leaseMs: 60_000 },
      'someone-else',
    );
    const added = await fetches.add(
      'check',
      job('fickle', '/p/stoneware-mug', { maxInFlight: 1 }),
      { jobId: 'busy' },
    );
    // It wakes every so often to ask again, and goes back to waiting each time.
    const states = new Set<string>();
    for (let i = 0; i < 20; i++) {
      states.add(String(await (await fetches.getJob(added.id!))?.getState()));
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    expect(states.has('delayed')).toBe(true);
    // And the check never ran while the site was busy.
    expect(await ingest.getJobs(['waiting'])).toHaveLength(0);

    await gate.release('fickle.localhost', 'someone-else');
    expect((await reports(1))[0]?.outcome).toBe('ok');
  });

  it('opens the breaker after repeated failures, then skips the site', async () => {
    settings.update('brittle', { errorRate: 1, rateLimitRate: 0, blockRate: 0 });
    for (let i = 0; i < 5; i++) await fetches.add('check', job('brittle'), { jobId: `fail-${i}` });
    const failures = await reports(5);
    expect(failures.every((r) => r.outcome === 'http_error')).toBe(true);
    expect(failures.filter((r) => r.breaker.change === 'opened')).toHaveLength(1);

    await fetches.add('check', job('brittle'), { jobId: 'after' });
    const last = (await reports(6)).at(-1)!;
    expect(last.outcome).toBe('skipped_breaker_open');
    expect(last.notBefore).toBeGreaterThan(Date.now() + 50_000);
  });

  it('holds the whole site after a 429, until its Retry-After', async () => {
    settings.update('brittle', { rateLimitRate: 1, errorRate: 0, blockRate: 0 });
    await fetches.add('check', job('brittle'), { jobId: 'limited' });
    const [report] = await reports(1);
    expect(report).toMatchObject({ outcome: 'rate_limited', retryAfterSeconds: 30 });
    expect(
      await gate.acquire('brittle.localhost', { gapMs: 0, maxInFlight: 5, leaseMs: 1_000 }, 'x'),
    ).toBeGreaterThan(25_000);
  });

  it('asks for a browser when the price isn’t in the HTML', async () => {
    settings.update('fickle', { layout: 'modern' });
    await fetches.add('check', job('fickle'), { jobId: 'modern' });
    expect((await reports(1))[0]).toMatchObject({ outcome: 'price_not_found', wantsBrowser: true });
  });
});
