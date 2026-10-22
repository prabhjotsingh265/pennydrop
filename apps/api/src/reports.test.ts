import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

const h = harness();
beforeEach(() => h.reset());
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

const get = (cookie: string, url: string) =>
  h.app.inject({ method: 'GET', url, headers: { cookie } });

async function add(cookie: string, payload: Record<string, unknown>) {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/watches',
    headers: { cookie, origin: APP_URL },
    payload,
  });
  return response.json().watch as { id: string; targetId: string };
}

let serial = 0;
async function check(targetId: string, outcome: 'ok' | 'timeout', minutesAgo: number, ms = 100) {
  const startedAt = new Date(Date.now() - minutesAgo * 60_000);
  await h.db.check.create({
    data: {
      targetId,
      jobId: `job-${++serial}`,
      reason: 'scheduled',
      mode: 'http',
      scheduledFor: startedAt,
      startedAt,
      finishedAt: new Date(startedAt.getTime() + ms),
      outcome,
      price: outcome === 'ok' ? 3400n : null,
      currency: 'GBP',
    },
  });
}

describe('GET /api/sites', () => {
  it('sums up each shop, from this workspace’s own checks only', async () => {
    const a = await h.signIn('a@example.com');
    const b = await h.signIn('b@example.com');
    const mug = await add(a, { url: 'https://fickle.example.com/p/mug' });
    await add(a, { url: 'https://fickle.example.com/p/teapot' });
    const theirs = await add(b, { url: 'https://fickle.example.com/p/lamp' });
    await check(mug.targetId, 'ok', 10, 100);
    await check(mug.targetId, 'timeout', 20, 300);
    await check(mug.targetId, 'ok', 60 * 30); // more than a day ago
    await check(theirs.targetId, 'timeout', 5); // someone else's
    const site = await h.db.site.findUniqueOrThrow({ where: { host: 'fickle.example.com' } });
    await h.db.recipe.create({
      data: { siteId: site.id, selector: '.price-now', source: 'healed' },
    });

    const { sites } = (await get(a, '/api/sites')).json();
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      host: 'fickle.example.com',
      products: 2,
      breaker: { state: 'closed' },
      recipe: { selector: '.price-now', source: 'healed' },
      lastDay: { checks: 2, good: 1, medianMs: 200 },
    });
  });

  it('is empty for a workspace watching nothing', async () => {
    expect((await get(await h.signIn(), '/api/sites')).json()).toEqual({ sites: [] });
  });
});

describe('GET /api/checks', () => {
  it('lists this workspace’s checks, newest first, a page at a time', async () => {
    const a = await h.signIn('a@example.com');
    const b = await h.signIn('b@example.com');
    const mug = await add(a, { url: 'https://fickle.example.com/p/mug', label: 'Mug' });
    const theirs = await add(b, { url: 'https://fickle.example.com/p/lamp' });
    for (const minutes of [1, 2, 3]) await check(mug.targetId, 'ok', minutes);
    await check(mug.targetId, 'timeout', 4);
    await check(theirs.targetId, 'ok', 0);

    const first = (await get(a, '/api/checks?limit=2')).json();
    expect(first.checks.map((c: { label: string }) => c.label)).toEqual(['Mug', 'Mug']);
    expect(first.checks[0].watchId).toBe(mug.id);
    expect(first.next).not.toBeNull();
    const rest = (
      await get(a, `/api/checks?limit=2&before=${encodeURIComponent(first.next)}`)
    ).json();
    expect(rest.checks.map((c: { outcome: string }) => c.outcome)).toEqual(['ok', 'timeout']);
    expect(rest.next).toBeNull();

    const problems = (await get(a, '/api/checks?show=problems')).json();
    expect(problems.checks.map((c: { outcome: string }) => c.outcome)).toEqual(['timeout']);
  });

  it('refuses a cursor that isn’t a time', async () => {
    const response = await get(await h.signIn(), '/api/checks?before=yesterday');
    expect(response.statusCode).toBe(422);
  });
});

describe('CSV exports', () => {
  it('exports the watchlist, and a name can’t become a spreadsheet formula', async () => {
    const a = await h.signIn();
    await add(a, {
      url: 'https://fickle.example.com/p/mug',
      label: '=HYPERLINK("http://evil.example.com")',
      targetPrice: 3000,
    });
    const response = await get(a, '/api/watches.csv');
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('pennydrop-watchlist.csv');
    const [header, row] = response.body.trim().split('\r\n');
    expect(header).toBe(
      'name,shop,address,price,currency,target,status,check_every_minutes,last_read',
    );
    expect(row).toMatch(/^"'=HYPERLINK\(""http:\/\/evil\.example\.com""\)",fickle\.example\.com,/);
    expect(row).toContain(',30.00,active,360,');
  });

  it('exports a product’s whole history as change points', async () => {
    const a = await h.signIn();
    const mug = await add(a, { url: 'https://fickle.example.com/p/mug', label: 'Stoneware mug' });
    await check(mug.targetId, 'ok', 60);
    const first = await h.db.check.findFirstOrThrow();
    await h.db.pricePoint.createMany({
      data: [
        {
          targetId: mug.targetId,
          firstSeenAt: new Date('2026-10-01T09:00:00Z'),
          lastSeenAt: new Date('2026-10-05T09:00:00Z'),
          price: 4200n,
          currency: 'GBP',
          inStock: true,
          firstCheckId: first.id,
        },
        {
          targetId: mug.targetId,
          firstSeenAt: new Date('2026-10-05T10:00:00Z'),
          lastSeenAt: new Date('2026-10-21T09:00:00Z'),
          price: 3450n,
          wasPrice: 4200n,
          currency: 'GBP',
          inStock: true,
          firstCheckId: first.id,
        },
      ],
    });
    const response = await get(a, `/api/watches/${mug.id}/history.csv`);
    expect(response.headers['content-disposition']).toContain('stoneware-mug-price-history.csv');
    expect(response.body.trim().split('\r\n')).toEqual([
      'first_seen,last_seen,price,was_price,currency,in_stock,replayed',
      '2026-10-01T09:00:00.000Z,2026-10-05T09:00:00.000Z,42.00,,GBP,true,false',
      '2026-10-05T10:00:00.000Z,2026-10-21T09:00:00.000Z,34.50,42.00,GBP,true,false',
    ]);
  });

  it('keeps each product’s history to its own workspace', async () => {
    const a = await h.signIn('a@example.com');
    const b = await h.signIn('b@example.com');
    const mug = await add(a, { url: 'https://fickle.example.com/p/mug' });
    expect((await get(b, `/api/watches/${mug.id}/history.csv`)).statusCode).toBe(404);
    expect((await get(b, '/api/watches/not-an-id/history.csv')).statusCode).toBe(404);
  });
});

describe('GET /api/checks/:id/screenshot', () => {
  it('shows a failed check’s screenshot to the workspace watching the page, and no one else', async () => {
    const a = await h.signIn('a@example.com');
    const b = await h.signIn('b@example.com');
    const mug = await add(a, { url: 'https://fickle.example.com/p/mug' });
    const at = new Date();
    const check = await h.db.check.create({
      data: {
        targetId: mug.targetId,
        jobId: 'scheduled-shot-1',
        reason: 'scheduled',
        mode: 'browser',
        scheduledFor: at,
        startedAt: at,
        finishedAt: at,
        outcome: 'blocked',
        screenshotKey: 'scheduled-shot-1',
      },
    });
    await writeFile(join(h.screenshotDir, 'scheduled-shot-1.jpg'), 'jpeg bytes');

    const listed = (await get(a, `/api/watches/${mug.id}/checks`)).json().checks;
    expect(listed[0]).toMatchObject({ id: check.id, screenshot: true });
    const image = await get(a, `/api/checks/${check.id}/screenshot`);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.body).toBe('jpeg bytes');

    expect((await get(b, `/api/checks/${check.id}/screenshot`)).statusCode).toBe(404);
  });

  it('says when a screenshot is no longer kept', async () => {
    const a = await h.signIn();
    const mug = await add(a, { url: 'https://fickle.example.com/p/mug' });
    const at = new Date();
    const check = await h.db.check.create({
      data: {
        targetId: mug.targetId,
        jobId: 'gone-shot',
        reason: 'scheduled',
        scheduledFor: at,
        startedAt: at,
        finishedAt: at,
        outcome: 'blocked',
        screenshotKey: 'gone-shot',
      },
    });
    const response = await get(a, `/api/checks/${check.id}/screenshot`);
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('That screenshot is no longer kept.');
  });
});
