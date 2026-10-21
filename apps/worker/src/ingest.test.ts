import { randomUUID } from 'node:crypto';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import {
  QUEUES,
  redisConnection,
  type CheckReport,
  type FetchJob,
  type IngestJob,
} from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingest, type IngestDeps } from './ingest.ts';

const db = testDb('worker');
const connection = redisConnection();
const NOW = Date.UTC(2026, 9, 21, 9, 0);
const MINUTE = 60_000;
let deps: IngestDeps;
let siteId = '';
let targetId = '';

beforeEach(async () => {
  await resetDatabase(db);
  const prefix = `test-${randomUUID()}`;
  deps = {
    db,
    queues: {
      http: new Queue<FetchJob>(QUEUES.fetchHttp, { connection, prefix }),
      browser: new Queue<FetchJob>(QUEUES.fetchBrowser, { connection, prefix }),
    },
    now: () => NOW,
    random: () => 0.5,
  };
  siteId = (
    await db.site.create({ data: { host: 'fickle.example.com', registrable: 'example.com' } })
  ).id;
  targetId = (
    await db.target.create({
      data: {
        siteId,
        url: 'https://fickle.example.com/p/mug',
        canonicalUrl: 'mug',
        nextCheckAt: new Date(NOW + 6 * 60 * MINUTE),
      },
    })
  ).id;
});
afterEach(async () => {
  for (const queue of Object.values(deps.queues)) {
    await queue.obliterate({ force: true });
    await queue.close();
  }
});
afterAll(async () => {
  await db.$disconnect();
  await connection.quit();
});

let serial = 0;
function job(extra: Partial<FetchJob> = {}): FetchJob {
  return {
    targetId,
    siteId,
    host: 'fickle.example.com',
    url: 'https://fickle.example.com/p/mug',
    reason: 'scheduled',
    scheduledFor: NOW,
    mode: 'auto',
    recipe: null,
    etag: null,
    lastModified: null,
    robots: null,
    gapMs: 10_000,
    maxInFlight: 1,
    currency: null,
    ...extra,
  };
}

function report(extra: Partial<CheckReport> = {}): CheckReport {
  return {
    outcome: 'ok',
    mode: 'http',
    status: 200,
    url: 'https://fickle.example.com/p/mug',
    amount: 3199,
    currency: 'GBP',
    was: null,
    inStock: true,
    confidence: 0.99,
    strategy: 'json-ld',
    conflict: false,
    locator: '.price-now',
    locatorAttribute: null,
    readings: [
      { strategy: 'json-ld', status: 'found', amount: 3199, confidence: 0.95, note: null },
    ],
    neededBrowser: false,
    wantsBrowser: false,
    notBefore: null,
    retryAfterSeconds: null,
    etag: '"v1"',
    lastModified: null,
    robots: null,
    crawlDelay: null,
    detail: 'Read from the page’s HTML.',
    timings: { total: 120 },
    startedAt: NOW,
    finishedAt: NOW + 120,
    breaker: { change: null, openUntil: null },
    worker: 'test',
    ...extra,
  };
}

const run = (r: Partial<CheckReport> = {}, j: Partial<FetchJob> = {}, id = `check-${++serial}`) =>
  ingest(deps, { checkJobId: id, job: job(j), report: report(r) } satisfies IngestJob);
const target = () => db.target.findUniqueOrThrow({ where: { id: targetId } });
const points = () =>
  db.pricePoint.findMany({ where: { targetId }, orderBy: { firstSeenAt: 'asc' } });
const eventKinds = async () =>
  (await db.event.findMany({ orderBy: { at: 'asc' } })).map((e) => e.kind);

describe('price history', () => {
  it('writes the first price, and remembers how it was read', async () => {
    expect(await run()).toMatchObject({ recorded: true, outcome: 'ok', priceChanged: true });
    expect(await points()).toMatchObject([{ price: 3199n, currency: 'GBP', inStock: true }]);
    expect(await target()).toMatchObject({ currentPrice: 3199n, etag: '"v1"', failureStreak: 0 });
    expect(await db.recipe.findMany()).toMatchObject([{ selector: '.price-now', source: 'auto' }]);
  });

  it('adds no row while nothing changes: the point just stays seen for longer', async () => {
    await run();
    expect(await run({ finishedAt: NOW + 3_600_000 })).toMatchObject({ priceChanged: false });
    const [point] = await points();
    expect(await points()).toHaveLength(1);
    expect(point!.lastSeenAt.getTime()).toBe(NOW + 3_600_000);
  });

  it('keeps the price seen for longer when the shop says the page hasn’t changed', async () => {
    await run();
    await run({ outcome: 'unchanged', amount: null, status: 304, finishedAt: NOW + 3_600_000 });
    const [point] = await points();
    expect(await points()).toHaveLength(1);
    expect(point!.lastSeenAt.getTime()).toBe(NOW + 3_600_000);
  });

  it('adds a row when the price moves', async () => {
    await run();
    await run({ amount: 2999, finishedAt: NOW + MINUTE });
    expect((await points()).map((p) => p.price)).toEqual([3199n, 2999n]);
  });

  it('records a check only once, however often its job runs', async () => {
    await run({}, {}, 'same');
    expect(await run({}, {}, 'same')).toMatchObject({ recorded: false });
    expect(await db.check.count()).toBe(1);
  });

  it('marks stock running out', async () => {
    await run();
    await run({ inStock: false, finishedAt: NOW + MINUTE });
    expect(await eventKinds()).toContain('out_of_stock');
  });
});

describe('suspicious jumps', () => {
  it('holds a big jump and looks again in two minutes before believing it', async () => {
    await run();
    expect(await run({ amount: 899, finishedAt: NOW + MINUTE })).toMatchObject({
      outcome: 'suspicious',
      priceChanged: false,
    });
    expect(await points()).toHaveLength(1);
    expect((await target()).pendingPrice).toBe(899n);
    const [confirm] = await deps.queues.http.getJobs(['delayed']);
    expect(confirm?.data.reason).toBe('confirm');

    // The second look sees the same price: now it's real.
    expect(
      await run({ amount: 899, finishedAt: NOW + 3 * MINUTE }, { reason: 'confirm' }),
    ).toMatchObject({ priceChanged: true });
    expect((await points()).map((p) => p.price)).toEqual([3199n, 899n]);
    expect((await target()).pendingPrice).toBeNull();
  });

  it('forgets the jump if the second look disagrees', async () => {
    await run();
    await run({ amount: 899, finishedAt: NOW + MINUTE });
    await run({ amount: 3199, finishedAt: NOW + 3 * MINUTE }, { reason: 'confirm' });
    expect(await points()).toHaveLength(1);
    expect((await target()).pendingPrice).toBeNull();
  });
});

describe('healing', () => {
  it('retires a broken selector and saves the one that found the price', async () => {
    const old = await db.recipe.create({
      data: { siteId, selector: '.price-now', source: 'auto' },
    });
    await run(
      {
        strategy: 'heuristic',
        locator: '[data-price]',
        readings: [
          { strategy: 'selector', status: 'missing', amount: null, confidence: null, note: null },
        ],
      },
      { recipe: { id: old.id, selector: '.price-now', attribute: null, pattern: null } },
    );
    const recipes = await db.recipe.findMany({ orderBy: { activeFrom: 'asc' } });
    expect(recipes).toMatchObject([
      { selector: '.price-now', misses: 1 },
      { selector: '[data-price]', source: 'healed', retiredAt: null },
    ]);
    expect(recipes[0]!.retiredAt).not.toBeNull();
    expect(await eventKinds()).toEqual(
      expect.arrayContaining(['layout_changed', 'selector_healed']),
    );
  });
});

describe('healing a whole site', () => {
  it('heals once, however many of the site’s products come back with the old selector', async () => {
    const old = await db.recipe.create({
      data: { siteId, selector: '.price-now', source: 'auto' },
    });
    const others = await Promise.all(
      [1, 2, 3].map((n) =>
        db.target.create({
          data: { siteId, url: `https://fickle.example.com/p/${n}`, canonicalUrl: `p${n}` },
        }),
      ),
    );
    const stale = {
      recipe: { id: old.id, selector: '.price-now', attribute: null, pattern: null },
    };
    const broken = {
      strategy: 'heuristic',
      locator: '[data-price]',
      readings: [
        {
          strategy: 'selector',
          status: 'missing' as const,
          amount: null,
          confidence: null,
          note: null,
        },
      ],
    };
    await Promise.all(
      [targetId, ...others.map((t) => t.id)].map((id) => run(broken, { ...stale, targetId: id })),
    );

    expect(await db.recipe.count({ where: { retiredAt: null } })).toBe(1);
    expect((await eventKinds()).filter((kind) => kind === 'selector_healed')).toHaveLength(1);
  });
});

describe('when checks fail', () => {
  it('tries again after about a minute, then four, then fifteen', async () => {
    const delays = [];
    for (let i = 0; i < 3; i++) {
      // What the dispatcher does on claiming the product: move it to its next regular slot.
      await db.target.update({
        where: { id: targetId },
        data: { nextCheckAt: new Date(NOW + 6 * 60 * MINUTE) },
      });
      await run({ outcome: 'timeout', amount: null });
      delays.push((await target()).nextCheckAt.getTime() - NOW);
    }
    expect(delays).toEqual([MINUTE, 4 * MINUTE, 15 * MINUTE]);
    expect((await target()).failureStreak).toBe(3);
  });

  it('gives up on a page that has been gone three times', async () => {
    for (let i = 0; i < 3; i++) await run({ outcome: 'gone', amount: null, status: 404 });
    expect((await target()).status).toBe('gone');
    expect(await eventKinds()).toContain('gone');
  });

  it('brings a product back once its price can be read again, unless it’s paused', async () => {
    await db.target.update({
      where: { id: targetId },
      data: { status: 'blocked', failureStreak: 4 },
    });
    await run();
    expect(await target()).toMatchObject({ status: 'active', failureStreak: 0 });

    await db.target.update({ where: { id: targetId }, data: { status: 'paused' } });
    await run();
    expect((await target()).status).toBe('paused');
  });

  it('waits out a 429 before trying again', async () => {
    await run({ outcome: 'rate_limited', amount: null, status: 429, notBefore: NOW + 30 * MINUTE });
    expect((await target()).nextCheckAt.getTime()).toBe(NOW + 30 * MINUTE);
  });

  it('comes back when the breaker lets it', async () => {
    await run({ outcome: 'skipped_breaker_open', amount: null, notBefore: NOW + 5 * MINUTE });
    expect(await target()).toMatchObject({
      failureStreak: 0,
      nextCheckAt: new Date(NOW + 5 * MINUTE),
    });
  });

  it('mirrors the breaker on the site, with an event', async () => {
    await run({
      outcome: 'http_error',
      amount: null,
      breaker: { change: 'opened', openUntil: NOW + 5 * MINUTE },
    });
    expect(await db.site.findUniqueOrThrow({ where: { id: siteId } })).toMatchObject({
      breakerState: 'open',
    });
    expect(await eventKinds()).toContain('breaker_opened');
  });
});

describe('browsers', () => {
  it('sends a page whose HTML has no price straight to the browser lane', async () => {
    expect(
      await run({ outcome: 'price_not_found', amount: null, wantsBrowser: true }, {}, 'needs-js'),
    ).toMatchObject({ recorded: true });
    const [escalated] = await deps.queues.browser.getJobs(['waiting']);
    expect(escalated).toMatchObject({ id: 'needs-js-browser', data: { mode: 'browser' } });
    expect((await target()).failureStreak).toBe(0);
  });

  it('remembers that the site needs a browser once one reads it', async () => {
    await run({ mode: 'browser', strategy: 'heuristic' }, { mode: 'browser' });
    expect((await db.site.findUniqueOrThrow({ where: { id: siteId } })).needsBrowser).toBe(true);
    expect(await eventKinds()).toContain('needs_browser');
  });
});

describe('robots.txt', () => {
  it('keeps the newest copy, and its crawl delay, on the site', async () => {
    await run({
      robots: { status: 'ok', body: 'User-agent: *\nCrawl-delay: 5', fetchedAt: NOW },
      crawlDelay: 5,
    });
    expect(await db.site.findUniqueOrThrow({ where: { id: siteId } })).toMatchObject({
      robotsStatus: 'ok',
      crawlDelay: 5,
    });
  });

  it('stops checking a page robots.txt now rules out', async () => {
    await run({ outcome: 'robots_disallowed', amount: null });
    expect((await target()).status).toBe('blocked');
  });
});
