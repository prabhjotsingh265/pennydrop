import { randomUUID } from 'node:crypto';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import {
  QUEUES,
  checkJobId,
  redisConnection,
  type CheckReport,
  type FetchJob,
  type IngestJob,
} from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingest } from './ingest.ts';
import {
  REPLAY_HOLD_MS,
  REPLAY_STEP_MS,
  continueReplay,
  startReplay,
  type ReplayDeps,
} from './replay.ts';

const db = testDb('worker');
const connection = redisConnection();
const NOW = Date.UTC(2026, 9, 22, 12, 0);
const DAY = 86_400_000;
let http: Queue<FetchJob>;
let browser: Queue<FetchJob>;
let deps: ReplayDeps;
let targetId = '';
let serial = 0;

beforeEach(async () => {
  await resetDatabase(db);
  const prefix = `test-${randomUUID()}`;
  http = new Queue<FetchJob>(QUEUES.fetchHttp, { connection, prefix });
  browser = new Queue<FetchJob>(QUEUES.fetchBrowser, { connection, prefix });
  deps = { db, http, now: () => NOW };
  const site = await db.site.create({
    data: { host: 'fickle.example.com', registrable: 'example.com', minGapMs: 1_000 },
  });
  await db.recipe.create({ data: { siteId: site.id, selector: '.price-now', source: 'auto' } });
  targetId = (
    await db.target.create({
      data: {
        siteId: site.id,
        url: 'https://fickle.example.com/p/mug',
        canonicalUrl: 'mug',
        currentPrice: 3199n,
        currency: 'GBP',
        nextCheckAt: new Date(NOW),
      },
    })
  ).id;
});
afterEach(async () => {
  for (const queue of [http, browser]) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
afterAll(async () => {
  await db.$disconnect();
  await connection.quit();
});

/** The page as the shop showed it at `at`, read as a replay. */
function replayed(job: FetchJob, amount: number | null, extra: Partial<CheckReport> = {}) {
  const report: CheckReport = {
    outcome: amount === null ? 'http_error' : 'ok',
    mode: 'http',
    status: amount === null ? 500 : 200,
    url: job.url,
    amount,
    currency: 'GBP',
    was: null,
    inStock: true,
    confidence: 0.99,
    strategy: 'json-ld',
    conflict: false,
    locator: '.price-now',
    locatorAttribute: null,
    readings: [],
    neededBrowser: false,
    wantsBrowser: false,
    notBefore: null,
    retryAfterSeconds: null,
    etag: null,
    lastModified: null,
    robots: null,
    crawlDelay: null,
    detail: 'Read from the page’s HTML.',
    timings: { total: 40 },
    // Fetched today, of course: only the moment asked for is in the past.
    startedAt: NOW + 1_000,
    finishedAt: NOW + 1_040,
    breaker: { change: null, openUntil: null },
    worker: 'test',
    ...extra,
  };
  return ingest({ db, queues: { http, browser } }, {
    checkJobId: `replay-${++serial}`,
    job,
    report,
  } satisfies IngestJob);
}

async function queued(): Promise<FetchJob[]> {
  return (await http.getJobs(['prioritized', 'waiting'])).map((j) => j.data);
}
const points = () =>
  db.pricePoint.findMany({ where: { targetId }, orderBy: { firstSeenAt: 'asc' } });

describe('startReplay', () => {
  it('asks for the page every six hours from 60 days ago, and holds a new product’s live checks', async () => {
    expect(await startReplay(deps, targetId)).toBe(60 * 4);
    const [first] = await queued();
    expect(first).toMatchObject({
      reason: 'replay',
      mode: 'http',
      scheduledFor: NOW - 60 * DAY,
      etag: null,
      recipe: { selector: '.price-now' },
      gapMs: 1_000,
      replay: { until: NOW, stepMs: REPLAY_STEP_MS, run: NOW },
    });
    // Behind every live check in the queue.
    expect((await http.getJobs(['prioritized']))[0]!.opts.priority).toBe(100);
    expect(
      (await db.target.findUniqueOrThrow({ where: { id: targetId } })).nextCheckAt.getTime(),
    ).toBe(NOW + REPLAY_HOLD_MS);
  });

  it('fills in before the first real reading of a product already being checked', async () => {
    const check = await db.check.create({
      data: {
        targetId,
        jobId: 'live',
        reason: 'scheduled',
        scheduledFor: new Date(NOW - 2 * DAY),
        startedAt: new Date(NOW - 2 * DAY),
        finishedAt: new Date(NOW - 2 * DAY),
        outcome: 'ok',
      },
    });
    await db.pricePoint.create({
      data: {
        targetId,
        firstSeenAt: new Date(NOW - 2 * DAY),
        lastSeenAt: new Date(NOW),
        price: 3199n,
        currency: 'GBP',
        inStock: true,
        firstCheckId: check.id,
      },
    });
    await startReplay(deps, targetId, { days: 10 });
    expect((await queued())[0]!.replay).toEqual({
      until: NOW - 2 * DAY,
      stepMs: REPLAY_STEP_MS,
      run: NOW,
    });
    // Its live checks carry on.
    expect(
      (await db.target.findUniqueOrThrow({ where: { id: targetId } })).nextCheckAt.getTime(),
    ).toBe(NOW);
  });
});

describe('a replayed reading', () => {
  async function firstStep() {
    await startReplay(deps, targetId, { days: 2 });
    return (await queued())[0]!;
  }

  it('is a point at its past moment, marked replayed, and leaves the product as it was', async () => {
    const step = await firstStep();
    expect(await replayed(step, 2999)).toMatchObject({ recorded: true, pricePointId: null });
    expect(await points()).toMatchObject([
      { firstSeenAt: new Date(NOW - 2 * DAY), price: 2999n, replayed: true },
    ]);
    const check = await db.check.findFirstOrThrow({ where: { reason: 'replay' } });
    expect(check.startedAt).toEqual(new Date(NOW - 2 * DAY));
    // Today's price, schedule and status are the live checks' business.
    expect(await db.target.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({
      currentPrice: 3199n,
      lastCheckedAt: null,
      status: 'active',
    });
  });

  it('extends a price that held, starts a new one when it changed, and changes nothing run twice', async () => {
    const step = await firstStep();
    const at = (n: number) => ({ ...step, scheduledFor: step.scheduledFor + n * REPLAY_STEP_MS });
    await replayed(at(0), 2999);
    await replayed(at(1), 2999);
    await replayed(at(2), 2499);
    await replayed(at(1), 2999); // the same moment again, under a new job id
    await replayed(at(3), null); // the shop failed: a gap, not a price
    expect(
      (await points()).map((p) => [
        p.price,
        (p.firstSeenAt.getTime() - step.scheduledFor) / REPLAY_STEP_MS,
        (p.lastSeenAt.getTime() - step.scheduledFor) / REPLAY_STEP_MS,
      ]),
    ).toEqual([
      [2999n, 0, 1],
      [2499n, 2, 2],
    ]);
  });

  it('never heals the site: the past page has the shop’s old layout', async () => {
    const step = await firstStep();
    await replayed(step, 2999, {
      strategy: 'heuristic',
      locator: '.cost',
      readings: [
        { strategy: 'selector', status: 'missing', amount: null, confidence: null, note: null },
      ],
    });
    expect((await db.recipe.findMany()).map((r) => [r.selector, r.retiredAt])).toEqual([
      ['.price-now', null],
    ]);
    expect(await db.event.count()).toBe(0);
  });
});

describe('continueReplay', () => {
  it('asks for the next moment, and at the end lets a new product’s live checks begin', async () => {
    await startReplay(deps, targetId, { days: 1 });
    let [step] = await queued();
    const steps: number[] = [];
    for (;;) {
      await replayed(step!, 2999);
      await http.obliterate({ force: true });
      steps.push(step!.scheduledFor);
      if ((await continueReplay(deps, step!)) === 'done') break;
      [step] = await queued();
    }
    expect(steps).toHaveLength(4);
    expect(
      (await db.target.findUniqueOrThrow({ where: { id: targetId } })).nextCheckAt.getTime(),
    ).toBe(NOW);
    // Run again, there's nothing left to replay.
    expect(await startReplay(deps, targetId, { days: 1 })).toBe(0);
  });

  it('reaches further back when asked for more days', async () => {
    await startReplay(deps, targetId, { days: 1 });
    const [first] = await queued();
    await replayed(first!, 2999);
    await http.obliterate({ force: true });
    expect(await startReplay(deps, targetId, { days: 3 })).toBe(12);
    expect((await queued())[0]!.scheduledFor).toBe(NOW - 3 * DAY);
  });

  it('runs again where a replay got nothing, under new job ids', async () => {
    await startReplay(deps, targetId, { days: 1 });
    const [first] = await queued();
    await replayed(first!, null); // the shop failed
    await http.obliterate({ force: true });
    const later = { ...deps, now: () => NOW + 60_000 };
    expect(await startReplay(later, targetId, { days: 1 })).toBe(4);
    const [again] = await queued();
    expect(again!.scheduledFor).toBe(NOW + 60_000 - DAY);
    expect(checkJobId(again!)).not.toBe(checkJobId(first!));
  });

  it('carries on after the last moment already replayed', async () => {
    await startReplay(deps, targetId, { days: 1 });
    const [step] = await queued();
    await replayed(step!, 2999);
    await http.obliterate({ force: true });
    expect(await startReplay(deps, targetId, { days: 1 })).toBe(3);
    expect((await queued())[0]!.scheduledFor).toBe(step!.scheduledFor + REPLAY_STEP_MS);
  });
});
