import { randomUUID } from 'node:crypto';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { QUEUES, redisConnection, type FetchJob } from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { afterAll, expect, it } from 'vitest';
import { dispatch, type DispatchQueues } from './dispatch.ts';

// The performance budget (make perf): a dispatcher tick under 200 ms with 10,000 products.
const SITES = 100;
const PER_SITE = 100;
const db = testDb('worker');
const connection = redisConnection();
const prefix = `perf-${randomUUID()}`;
const queues: DispatchQueues = {
  http: new Queue<FetchJob>(QUEUES.fetchHttp, { connection, prefix }),
  browser: new Queue<FetchJob>(QUEUES.fetchBrowser, { connection, prefix }),
};
afterAll(async () => {
  for (const queue of [queues.http, queues.browser]) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  await resetDatabase(db);
  await db.$disconnect();
  await connection.quit();
});

async function tick() {
  const started = performance.now();
  const result = await dispatch(db, queues);
  return { ms: performance.now() - started, ...result };
}

it(`ticks in under 200 ms with ${SITES * PER_SITE} products`, async () => {
  await resetDatabase(db);
  const sites = Array.from({ length: SITES }, (_, i) => ({
    id: randomUUID(),
    host: `shop-${i}.example`,
    registrable: `shop-${i}.example`,
  }));
  await db.site.createMany({ data: sites });
  await db.target.createMany({
    data: sites.flatMap((site) =>
      Array.from({ length: PER_SITE }, (_, i) => ({
        siteId: site.id,
        url: `https://${site.host}/p/${i}`,
        canonicalUrl: `https://${site.host}/p/${i}`,
        intervalSeconds: 3600,
        nextCheckAt: new Date(Date.now() + 3_600_000),
      })),
    ),
  });
  await db.$executeRaw`ANALYZE targets`;
  await tick(); // warmed up

  // Most ticks: 10,000 products, none of them due.
  const quiet: number[] = [];
  for (let i = 0; i < 20; i++) {
    const result = await tick();
    expect(result.dispatched).toBe(0);
    quiet.push(result.ms);
  }

  // The worst: all 10,000 due at once. Each tick claims a batch, gives each its next time and
  // queues its check, until the queues are as full as they're allowed to be.
  await db.$executeRaw`UPDATE targets SET next_check_at = now() - interval '1 minute'`;
  const busy: number[] = [];
  let queued = 0;
  for (let i = 0; i < 10; i++) {
    const result = await tick();
    if (result.held) break;
    queued += result.dispatched;
    busy.push(result.ms);
  }
  const max = (ms: number[]) => Math.max(...ms);
  const median = (ms: number[]) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)]!;
  console.log(
    `dispatcher tick, ${SITES * PER_SITE} products: none due median ${median(quiet).toFixed(1)} ms, ` +
      `slowest ${max(quiet).toFixed(1)} ms; all due (${busy.length} ticks, ${queued} queued) ` +
      `median ${median(busy).toFixed(1)} ms, slowest ${max(busy).toFixed(1)} ms`,
  );
  expect(queued).toBeGreaterThanOrEqual(5_000);
  expect(max(quiet)).toBeLessThan(200);
  expect(max(busy)).toBeLessThan(200);
});
