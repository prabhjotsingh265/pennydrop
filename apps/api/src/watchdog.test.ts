import { randomUUID } from 'node:crypto';
import type { Email } from '@pennydrop/alerts';
import { redisConnection } from '@pennydrop/queue';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { harness } from '../test/harness.ts';
import {
  BACKUP_LATE_MS,
  BEHIND_MS,
  GRACE_MS,
  NO_READ_MS,
  problemsIn,
  readyAt,
  report,
  vitalsOf,
  type Problem,
  type Vitals,
  type WatchdogDeps,
} from './watchdog.ts';

const MINUTE = 60_000;
const NOW = Date.parse('2026-10-23T12:00:00Z');
const healthy: Vitals = {
  lastRead: NOW - MINUTE,
  expectsReads: true,
  oldestDue: null,
  queues: [{ name: 'fetch-http', workers: 1, oldestReady: NOW - MINUTE }],
  lastBackup: NOW - 3 * 60 * MINUTE,
};
const ids = (problems: Problem[]) => problems.map((problem) => problem.id);

describe('problemsIn', () => {
  it('finds nothing wrong with a working Pennydrop', () => {
    expect(problemsIn(healthy, NOW)).toEqual([]);
  });

  it('notices when no check has read a page for 15 minutes, if one should have', () => {
    const quiet = { ...healthy, lastRead: NOW - NO_READ_MS - MINUTE };
    expect(problemsIn(quiet, NOW)).toEqual([
      { id: 'reads', text: 'No check has read a page for 16 minutes.' },
    ]);
    expect(problemsIn({ ...healthy, lastRead: NOW - NO_READ_MS }, NOW)).toEqual([]);
    expect(ids(problemsIn({ ...healthy, lastRead: null }, NOW))).toEqual(['reads']);
    // Nothing is watched often enough to expect a read: quiet is fine.
    expect(problemsIn({ ...quiet, expectsReads: false }, NOW)).toEqual([]);
  });

  it('notices a schedule 10 minutes behind', () => {
    expect(problemsIn({ ...healthy, oldestDue: NOW - BEHIND_MS }, NOW)).toEqual([]);
    expect(problemsIn({ ...healthy, oldestDue: NOW - 12 * MINUTE }, NOW)).toEqual([
      {
        id: 'schedule',
        text: 'The schedule is 12 minutes behind: products are due, and no checks are being queued for them.',
      },
    ]);
  });

  it('notices a queue with no worker, or one falling behind', () => {
    const queues = [
      { name: 'ingest', workers: 0, oldestReady: null },
      { name: 'fetch-http', workers: 2, oldestReady: NOW - 11 * MINUTE },
      { name: 'notify', workers: 1, oldestReady: NOW - BEHIND_MS },
    ];
    expect(problemsIn({ ...healthy, queues }, NOW)).toEqual([
      { id: 'workers:ingest', text: 'No worker is taking ingest jobs.' },
      { id: 'queue:fetch-http', text: 'The fetch-http queue is 11 minutes behind.' },
    ]);
  });

  it('notices a missed backup, where backups are made', () => {
    expect(problemsIn({ ...healthy, lastBackup: NOW - BACKUP_LATE_MS }, NOW)).toEqual([]);
    expect(problemsIn({ ...healthy, lastBackup: NOW - 30 * 60 * MINUTE }, NOW)).toEqual([
      { id: 'backup', text: 'The newest database backup is 30 hours old.' },
    ]);
    // None ever recorded: backups aren't made here (development).
    expect(problemsIn({ ...healthy, lastBackup: null }, NOW)).toEqual([]);
  });
});

describe('readyAt', () => {
  it('counts a waiting job from when it was added, or when it last ran if it was put back', () => {
    expect(readyAt({ timestamp: NOW, processedOn: undefined, delay: 0 })).toBe(NOW);
    expect(readyAt({ timestamp: NOW, processedOn: undefined, delay: 15_000 })).toBe(NOW + 15_000);
    // Added an hour ago, last run a minute ago, then put back for 10 s.
    expect(
      readyAt({ timestamp: NOW - 60 * MINUTE, processedOn: NOW - MINUTE, delay: 10_000 }),
    ).toBe(NOW - MINUTE + 10_000);
  });
});

const connection = redisConnection();
const prefix = `test-${randomUUID()}`;
const h = harness();
const queue = new Queue('fetch-http', { connection, prefix });
afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
  await connection.del(`${prefix}:watchdog:problems`);
  await h.app.close();
  await h.db.$disconnect();
  await connection.quit();
});

describe('report', () => {
  let now = NOW;
  const sent: Email[] = [];
  let failing = false;
  const deps: WatchdogDeps = {
    db: h.db,
    redis: connection,
    queues: {},
    mail: async (email) => {
      if (failing) throw new Error('Resend is down');
      sent.push(email);
    },
    config: { adminEmails: ['ops@example.com', 'me@example.com'], appUrl: 'https://p.example' },
    now: () => now,
    prefix: `${prefix}:watchdog`,
  };
  const stalled = { id: 'reads', text: 'No check has read a page for 16 minutes.' };
  const behind = { id: 'queue:ingest', text: 'The ingest queue is 11 minutes behind.' };

  beforeEach(async () => {
    now = NOW;
    sent.length = 0;
    failing = false;
    await connection.del(`${prefix}:watchdog:problems`);
  });

  it('tells every admin once a problem has lasted two minutes, and once when it ends', async () => {
    expect(await report(deps, [stalled])).toEqual({ told: [], ended: [] });
    now += GRACE_MS - 1;
    expect((await report(deps, [stalled])).told).toEqual([]);
    now += 1;
    expect((await report(deps, [stalled])).told).toEqual([stalled]);
    expect(sent.map((email) => email.to)).toEqual(['ops@example.com', 'me@example.com']);
    expect(sent[0]!.subject).toBe(
      'Pennydrop needs a look: No check has read a page for 16 minutes.',
    );
    expect(sent[0]!.text).toContain('https://p.example/admin');

    // Still going: nobody is told again.
    now += 10 * MINUTE;
    expect((await report(deps, [stalled])).told).toEqual([]);
    expect(sent).toHaveLength(2);

    now += MINUTE;
    expect((await report(deps, [])).ended).toEqual([stalled]);
    expect(sent[2]!.subject).toBe(
      'Pennydrop is back to normal: No check has read a page for 16 minutes.',
    );
    expect(await report(deps, [])).toEqual({ told: [], ended: [] });
  });

  it('says nothing about a problem that ends within the two minutes, such as a deploy', async () => {
    await report(deps, [behind]);
    now += MINUTE;
    await report(deps, []);
    now += 5 * MINUTE;
    await report(deps, []);
    expect(sent).toEqual([]);
  });

  it('mentions what else is still wrong', async () => {
    await report(deps, [stalled]);
    now += GRACE_MS;
    await report(deps, [stalled, behind]);
    now += GRACE_MS;
    expect((await report(deps, [stalled, behind])).told).toEqual([behind]);
    expect(sent.at(-1)!.text).toContain(`Still going on: ${stalled.text}`);
  });

  it('tries again on the next look when the email fails', async () => {
    await report(deps, [stalled]);
    now += GRACE_MS;
    failing = true;
    await expect(report(deps, [stalled])).rejects.toThrow('Resend is down');
    failing = false;
    now += MINUTE;
    expect((await report(deps, [stalled])).told).toEqual([stalled]);

    failing = true;
    await expect(report(deps, [])).rejects.toThrow('Resend is down');
    failing = false;
    expect((await report(deps, [])).ended).toEqual([stalled]);
  });
});

describe('vitalsOf', () => {
  beforeEach(async () => {
    await h.reset();
    await queue.obliterate({ force: true });
  });

  async function product(minutesOld: number, intervalSeconds: number) {
    const site = await h.db.site.upsert({
      where: { host: 'fickle.localhost' },
      update: {},
      create: { host: 'fickle.localhost', registrable: 'fickle.localhost' },
    });
    return h.db.target.create({
      data: {
        siteId: site.id,
        url: `u-${randomUUID()}`,
        canonicalUrl: `u-${randomUUID()}`,
        intervalSeconds,
        createdAt: new Date(Date.now() - minutesOld * MINUTE),
        nextCheckAt: new Date(Date.now() + MINUTE),
      },
    });
  }

  async function check(
    targetId: string,
    minutesAgo: number,
    outcome: 'ok' | 'timeout',
    reason = 'scheduled',
  ) {
    const at = new Date(Date.now() - minutesAgo * MINUTE);
    await h.db.check.create({
      data: {
        targetId,
        jobId: randomUUID(),
        reason: reason as 'scheduled',
        scheduledFor: at,
        startedAt: at,
        finishedAt: new Date(at.getTime() + 300),
        outcome,
      },
    });
  }

  const look = () =>
    vitalsOf({
      db: h.db,
      redis: connection,
      queues: { 'fetch-http': queue },
      mail: async () => {},
      config: { adminEmails: [], appUrl: '' },
      now: Date.now,
    });

  it('expects a read only of a product checked every 15 minutes, watched for 15 minutes', async () => {
    await product(60, 3_600);
    await product(5, 900);
    expect((await look()).expectsReads).toBe(false);
    await product(20, 900);
    expect((await look()).expectsReads).toBe(true);
  });

  it('finds the last check that read a page, replays and failures aside', async () => {
    const target = await product(60, 900);
    await check(target.id, 20, 'ok');
    await check(target.id, 3, 'timeout');
    await check(target.id, 1, 'ok', 'replay');
    const { lastRead } = await look();
    expect(Date.now() - lastRead!).toBeGreaterThanOrEqual(20 * MINUTE);
    expect(Date.now() - lastRead!).toBeLessThan(21 * MINUTE);
  });

  it('finds the most overdue product', async () => {
    const target = await product(60, 900);
    const due = new Date(Date.now() - 12 * MINUTE);
    await h.db.target.update({ where: { id: target.id }, data: { nextCheckAt: due } });
    expect((await look()).oldestDue).toBe(due.getTime());
  });

  it('finds the newest backup, if any were ever made', async () => {
    expect((await look()).lastBackup).toBeNull();
    const at = new Date(Date.now() - 3 * 60 * MINUTE);
    await h.db.backup.create({
      data: { takenAt: at, file: 'pennydrop-2026-10-23.dump', bytes: 1024n },
    });
    await h.db.backup.create({
      data: { takenAt: new Date(at.getTime() - 24 * 60 * MINUTE), file: 'old.dump', bytes: 1n },
    });
    expect((await look()).lastBackup).toBe(at.getTime());
  });

  it('counts each queue’s workers and finds its oldest waiting job, replays aside', async () => {
    const old = Date.now() - 20 * MINUTE;
    await queue.add('check', { reason: 'replay' }, { timestamp: old - MINUTE });
    await queue.add('check', { reason: 'scheduled' }, { timestamp: old });
    await queue.add('check', { reason: 'scheduled' });
    expect((await look()).queues).toEqual([{ name: 'fetch-http', workers: 0, oldestReady: old }]);

    const worker = new Worker('fetch-http', null, { connection, prefix, autorun: false });
    await worker.waitUntilReady();
    expect((await look()).queues[0]!.workers).toBe(1);
    await worker.close();
  });
});
