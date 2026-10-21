import { randomUUID } from 'node:crypto';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { QUEUES, redisConnection, type FetchJob } from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatch, type DispatchQueues } from './dispatch.ts';
import { steadyOffset } from './schedule.ts';

const db = testDb('worker');
const connection = redisConnection();
const NOW = Date.UTC(2026, 9, 21, 9, 0);
const HOUR = 3_600_000;
let queues: DispatchQueues;

beforeEach(async () => {
  await resetDatabase(db);
  const prefix = `test-${randomUUID()}`;
  queues = {
    http: new Queue<FetchJob>(QUEUES.fetchHttp, { connection, prefix }),
    browser: new Queue<FetchJob>(QUEUES.fetchBrowser, { connection, prefix }),
  };
});
afterEach(async () => {
  for (const queue of [queues.http, queues.browser]) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
afterAll(async () => {
  await db.$disconnect();
  await connection.quit();
});

async function site(host: string, extra: Record<string, unknown> = {}) {
  return db.site.create({ data: { host, registrable: host, ...extra } });
}
async function targets(siteId: string, count: number, extra: Record<string, unknown> = {}) {
  await db.target.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      siteId,
      url: `https://${siteId}.example.com/p/${i}`,
      canonicalUrl: `${siteId}/${i}`,
      intervalSeconds: 3600,
      nextCheckAt: new Date(NOW - 1000),
      ...extra,
    })),
  });
}
const queued = async (queue: Queue) =>
  (await queue.getJobs(['waiting', 'delayed', 'prioritized'])).length;

describe('dispatch', () => {
  it('queues every due product once and moves it to its next steady slot', async () => {
    const { id } = await site('fickle.example.com');
    await targets(id, 3);
    await db.target.create({
      data: { siteId: id, url: 'later', canonicalUrl: 'later', nextCheckAt: new Date(NOW + HOUR) },
    });

    expect(await dispatch(db, queues, { now: () => NOW })).toMatchObject({
      dispatched: 3,
      held: false,
    });
    expect(await queued(queues.http)).toBe(3);

    for (const target of await db.target.findMany({ where: { canonicalUrl: { not: 'later' } } })) {
      const next = target.nextCheckAt.getTime();
      expect(next).toBeGreaterThan(NOW);
      expect((next - steadyOffset(target.id, HOUR)) % HOUR).toBe(0);
    }
    // Nothing is due any more, so a second tick queues nothing.
    expect((await dispatch(db, queues, { now: () => NOW })).dispatched).toBe(0);
  });

  it('never claims a product twice, however many dispatchers run at once', async () => {
    const { id } = await site('fickle.example.com');
    await targets(id, 40);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => dispatch(db, queues, { now: () => NOW })),
    );
    expect(results.reduce((sum, r) => sum + r.dispatched, 0)).toBe(40);
    expect(await queued(queues.http)).toBe(40);
  });

  it('sends sites that need a browser to the browser queue', async () => {
    const { id } = await site('modern.example.com', { needsBrowser: true });
    await targets(id, 2);
    await dispatch(db, queues, { now: () => NOW });
    expect(await queued(queues.browser)).toBe(2);
    expect(await queued(queues.http)).toBe(0);
  });

  it('leaves paused products and blocked sites alone', async () => {
    const blocked = await site('blocked.example.com', { policy: 'blocked' });
    const fine = await site('fine.example.com');
    await targets(blocked.id, 2);
    await targets(fine.id, 2, { status: 'paused' });
    expect((await dispatch(db, queues, { now: () => NOW })).dispatched).toBe(0);
  });

  it('keeps checking products that need attention, and probes blocked and gone ones daily', async () => {
    const { id } = await site('fickle.example.com');
    const cases = [
      ['needs_attention', 3],
      ['blocked', 3],
      ['gone', 5],
      ['gone', 10],
    ] as const;
    for (const [status, failureStreak] of cases) {
      const key = `${status}-${failureStreak}`;
      await db.target.create({
        data: {
          siteId: id,
          url: key,
          canonicalUrl: key,
          status,
          failureStreak,
          intervalSeconds: 3600,
          nextCheckAt: new Date(NOW - 1000),
        },
      });
    }
    // The page gone for a week is left alone.
    expect((await dispatch(db, queues, { now: () => NOW })).dispatched).toBe(3);

    const DAY = 24 * HOUR;
    const byKey = new Map((await db.target.findMany()).map((t) => [t.canonicalUrl, t]));
    const slot = (key: string, every: number) => {
      const target = byKey.get(key)!;
      return (target.nextCheckAt.getTime() - steadyOffset(target.id, every)) % every;
    };
    expect(slot('needs_attention-3', HOUR)).toBe(0);
    expect(slot('blocked-3', DAY)).toBe(0);
    expect(slot('gone-5', DAY)).toBe(0);
    expect(byKey.get('gone-10')!.nextCheckAt.getTime()).toBe(NOW - 1000);
  });

  it('adds nothing while the queues are full', async () => {
    const { id } = await site('fickle.example.com');
    await targets(id, 5);
    expect(await dispatch(db, queues, { now: () => NOW, maxQueued: 3 })).toMatchObject({
      dispatched: 3,
    });
    expect(await dispatch(db, queues, { now: () => NOW, maxQueued: 3 })).toMatchObject({
      dispatched: 0,
      held: true,
    });
  });

  it('stretches intervals when a site’s products want more than its pace allows', async () => {
    // One visit every 10 s is 360 an hour; 720 hourly products want twice that.
    const { id } = await site('busy.example.com', { minGapMs: 10_000 });
    await targets(id, 720);
    await dispatch(db, queues, { now: () => NOW, batch: 720, maxQueued: 10_000 });
    const gaps = (await db.target.findMany()).map((t) => t.nextCheckAt.getTime() - NOW);
    expect(Math.max(...gaps)).toBeGreaterThan(1.5 * HOUR);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2 * HOUR);
  });

  it('hands the fetcher everything it needs: selector, robots.txt and pace', async () => {
    const { id } = await site('fickle.example.com', {
      crawlDelay: 30,
      robotsStatus: 'ok',
      robotsTxt: 'User-agent: *\nDisallow: /basket',
      robotsFetchedAt: new Date(NOW - HOUR),
    });
    await db.recipe.create({ data: { siteId: id, selector: '.price-now', source: 'auto' } });
    await targets(id, 1);
    await dispatch(db, queues, { now: () => NOW });
    const [job] = await queues.http.getJobs(['waiting']);
    expect(job?.data).toMatchObject({
      mode: 'auto',
      gapMs: 30_000,
      recipe: { selector: '.price-now' },
      robots: { status: 'ok', body: 'User-agent: *\nDisallow: /basket' },
    });
    expect(job?.id).toBe(`scheduled-${job?.data.targetId}-${NOW - 1000}`);
  });
});
