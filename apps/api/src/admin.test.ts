import { randomUUID } from 'node:crypto';
import { QUEUES, redisConnection } from '@pennydrop/queue';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';
import { LANES, briefly } from './admin.ts';

const connection = redisConnection();
const prefix = `test-${randomUUID()}`;
const queues = Object.fromEntries(
  [QUEUES.fetchHttp, QUEUES.maintenance].map((name) => [
    name,
    new Queue(name, { connection, prefix }),
  ]),
);
const h = harness({ queues });

beforeEach(async () => {
  h.sent.length = 0;
  await h.reset();
  for (const queue of Object.values(queues)) await queue.obliterate({ force: true });
});
afterAll(async () => {
  for (const queue of Object.values(queues)) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
  await h.app.close();
  await h.db.$disconnect();
  await connection.quit();
});

function as(cookie: string) {
  const headers = { cookie, origin: APP_URL };
  return (method: 'GET' | 'POST', url: string) => h.app.inject({ method, url, headers });
}

async function checks(minutesAgo: number[], outcome: 'ok' | 'timeout', host = 'fickle.localhost') {
  const site = await h.db.site.upsert({
    where: { host },
    update: {},
    create: { host, registrable: host },
  });
  const target = await h.db.target.create({
    data: { siteId: site.id, url: `u-${randomUUID()}`, canonicalUrl: `u-${randomUUID()}` },
  });
  for (const ago of minutesAgo) {
    const at = new Date(Date.now() - ago * 60_000);
    await h.db.check.create({
      data: {
        targetId: target.id,
        jobId: randomUUID(),
        reason: 'scheduled',
        scheduledFor: at,
        startedAt: new Date(at.getTime() - 400),
        finishedAt: at,
        outcome,
      },
    });
  }
}

describe('the System page', () => {
  it('is there for admins only, and doesn’t exist for anyone else', async () => {
    const someone = as(await h.signIn('someone@example.com'));
    expect((await someone('GET', '/api/admin/system')).statusCode).toBe(404);
    expect((await someone('GET', '/api/me')).json().user.isAdmin).toBe(false);
    const admin = as(await h.signIn('admin@example.com'));
    expect((await admin('GET', '/api/me')).json().user.isAdmin).toBe(true);
    expect((await admin('GET', '/api/admin/system')).statusCode).toBe(200);
  });

  it('counts the queues and their workers, the checks a minute, and each site’s', async () => {
    await queues[QUEUES.fetchHttp]!.add('check', {});
    const worker = new Worker(QUEUES.fetchHttp, null, { connection, prefix, autorun: false });
    await worker.waitUntilReady();
    await checks([1, 1, 2], 'ok');
    await checks([1], 'timeout', 'brittle.localhost');
    const admin = as(await h.signIn('admin@example.com'));
    const system = (await admin('GET', '/api/admin/system')).json();
    expect(system.queues).toContainEqual(
      expect.objectContaining({ name: QUEUES.fetchHttp, waiting: 1, workers: 1 }),
    );
    const total = system.throughput.reduce(
      (sum: { read: number; notRead: number }, minute: { read: number; notRead: number }) => ({
        read: sum.read + minute.read,
        notRead: sum.notRead + minute.notRead,
      }),
      { read: 0, notRead: 0 },
    );
    expect(total).toEqual({ read: 3, notRead: 1 });
    expect(system.sites.slice(0, 2)).toMatchObject([
      { host: 'fickle.localhost', read: 3, notRead: 0 },
      { host: 'brittle.localhost', read: 0, notRead: 1 },
    ]);
    await worker.close();
  });

  it('gives lanes to the busiest sites only, in name order', async () => {
    for (let i = 0; i < 10; i++) await checks([1], 'ok', `quiet-${i}.localhost`);
    await checks([1, 1, 1], 'ok', 'zebra.localhost');
    await checks([1, 1], 'timeout', 'brittle.localhost');
    const admin = as(await h.signIn('admin@example.com'));
    const { sites } = (await admin('GET', '/api/admin/lanes')).json();
    expect(sites).toHaveLength(LANES);
    const hosts = sites.map((site: { host: string }) => site.host);
    expect(hosts).toContain('zebra.localhost');
    expect(hosts).toContain('brittle.localhost');
    expect(hosts).toEqual([...hosts].sort());
  });

  it('gives the lanes every check since the last look', async () => {
    await checks([3], 'ok');
    const admin = as(await h.signIn('admin@example.com'));
    const since = Date.now() - 60_000;
    await checks([0.2], 'timeout', 'brittle.localhost');
    const lanes = (await admin('GET', `/api/admin/lanes?since=${since}`)).json();
    expect(lanes.checks).toEqual([
      expect.objectContaining({
        host: 'brittle.localhost',
        outcome: 'timeout',
        read: false,
        ms: 400,
      }),
    ]);
  });

  it('runs the nightly chores on request', async () => {
    const admin = as(await h.signIn('admin@example.com'));
    expect((await admin('POST', '/api/admin/maintenance')).statusCode).toBe(202);
    expect(await queues[QUEUES.maintenance]!.count()).toBe(1);
  });
});

describe('briefly', () => {
  it('keeps what failed and why, from a long error', () => {
    const prisma =
      'Invalid `prisma.check.create()` invocation:\n\n{ data: { … } }\n\nUnknown argument `screenshotKey`.';
    expect(briefly(prisma)).toBe(
      'Invalid `prisma.check.create()` invocation: … Unknown argument `screenshotKey`.',
    );
    expect(briefly('Timed out')).toBe('Timed out');
    expect(briefly('x'.repeat(400))).toHaveLength(300);
  });
});
