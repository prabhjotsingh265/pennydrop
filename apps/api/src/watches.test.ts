import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';
import { labelFromUrl } from './watches.ts';

const h = harness();
beforeEach(async () => {
  h.sent.length = 0;
  h.wake.mockClear();
  h.resolved.clear();
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

const MUG = 'https://fickle.example.com/p/stoneware-mug';
const DAY = 86_400_000;

function as(cookie: string) {
  const headers = { cookie, origin: APP_URL };
  return {
    list: () => h.app.inject({ method: 'GET', url: '/api/watches', headers }),
    add: (payload: Record<string, unknown>) =>
      h.app.inject({ method: 'POST', url: '/api/watches', headers, payload }),
    get: (id: string, path = '') =>
      h.app.inject({ method: 'GET', url: `/api/watches/${id}${path}`, headers }),
    update: (id: string, payload: Record<string, unknown>) =>
      h.app.inject({ method: 'PATCH', url: `/api/watches/${id}`, headers, payload }),
    remove: (id: string) => h.app.inject({ method: 'DELETE', url: `/api/watches/${id}`, headers }),
    checkNow: (id: string) =>
      h.app.inject({ method: 'POST', url: `/api/watches/${id}/check`, headers }),
  };
}

const target = (id: string) => h.db.target.findUniqueOrThrow({ where: { id } });

describe('adding a product', () => {
  it('cleans the address, shares the page and asks for a check straight away', async () => {
    const me = as(await h.signIn());
    const response = await me.add({
      url: 'Fickle.Example.com/p/stoneware-mug?utm_source=mail#reviews',
      targetPrice: 3000,
    });
    expect(response.statusCode).toBe(201);
    const { watch } = response.json();
    expect(watch).toMatchObject({
      url: MUG,
      host: 'fickle.example.com',
      label: 'Stoneware mug',
      targetPrice: 3000,
      status: 'active',
      intervalSeconds: 21_600,
      history: [],
    });
    expect(h.wake).toHaveBeenCalledOnce();
    const site = await h.db.site.findUniqueOrThrow({ where: { host: 'fickle.example.com' } });
    expect(site).toMatchObject({ registrable: 'example.com', demoAllowed: false });
  });

  it('opens the one you already have rather than adding it twice, even all at once', async () => {
    const me = as(await h.signIn());
    const responses = await Promise.all([me.add({ url: MUG }), me.add({ url: MUG })]);
    const ids = new Set(responses.map((response) => response.json().watch.id));
    expect(ids.size).toBe(1);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(await h.db.watch.count()).toBe(1);
  });

  it('checks a shared page as often as its keenest watcher asks', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    const a = (await mine.add({ url: MUG, intervalSeconds: 86_400 })).json().watch;
    const b = (await theirs.add({ url: MUG, intervalSeconds: 3_600 })).json().watch;
    expect(a.targetId).toBe(b.targetId);
    expect((await target(a.targetId)).intervalSeconds).toBe(3_600);
    // Each still sees their own choice.
    expect((await mine.get(a.id)).json().watch.intervalSeconds).toBe(86_400);
  });

  it.each([
    ['ftp://fickle.example.com/p/mug', 'That doesn’t look like a product page address.'],
    ['not an address', 'That doesn’t look like a product page address.'],
    ['https://me:secret@fickle.example.com/p', 'Addresses with a username or password'],
    ['http://192.168.1.20/p/mug', 'We can’t check addresses inside private networks.'],
    ['http://[::1]:8080/p', 'We can’t check addresses inside private networks.'],
    [
      'http://169.254.169.254/latest/meta-data',
      'We can’t check addresses inside private networks.',
    ],
    ['localhost:3000/p/mug', 'We can’t check addresses inside private networks.'],
    ['http://fickle.localhost:4000/p/mug', 'We can’t check addresses inside private networks.'],
  ])('refuses %s', async (url, error) => {
    const me = as(await h.signIn());
    const response = await me.add({ url });
    expect(response.statusCode).toBe(422);
    expect(response.json().field).toBe('url');
    expect(response.json().error).toContain(error);
    expect(h.wake).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves inside a private network', async () => {
    h.resolved.set('intranet.example.com', ['10.0.0.5']);
    const me = as(await h.signIn());
    const response = await me.add({ url: 'https://intranet.example.com/p/1' });
    expect(response.json().error).toBe('We can’t check addresses inside private networks.');
  });

  it('keeps 15-minute checks for the practice shops', async () => {
    const me = as(await h.signIn());
    const response = await me.add({ url: MUG, intervalSeconds: 900 });
    expect(response.statusCode).toBe(422);
    expect(response.json().field).toBe('intervalSeconds');
  });

  it('refuses shops that don’t allow automated checks', async () => {
    await h.db.site.create({
      data: { host: 'fickle.example.com', registrable: 'example.com', policy: 'api_only' },
    });
    const response = await as(await h.signIn()).add({ url: MUG });
    expect(response.json().error).toBe(
      'This shop doesn’t allow automated checks. It offers an API instead.',
    );
  });

  it('stops at the workspace’s limit', async () => {
    const me = as(await h.signIn());
    await h.db.workspace.updateMany({ data: { maxWatches: 1 } });
    expect((await me.add({ url: MUG })).statusCode).toBe(201);
    const second = await me.add({ url: 'https://fickle.example.com/p/teapot' });
    expect(second.statusCode).toBe(422);
    expect(second.json().error).toBe('This workspace can watch up to 1 products.');
    // Opening one you already have still works at the limit.
    expect((await me.add({ url: MUG })).statusCode).toBe(200);
  });

  it('says which field was wrong when the input itself is', async () => {
    const response = await as(await h.signIn()).add({ url: MUG, targetPrice: -5 });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues[0].path).toEqual(['targetPrice']);
  });
});

describe('the watchlist', () => {
  it('shows the last 30 days of each price, starting from where it stood', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    const now = Date.now();
    const check = await h.db.check.create({
      data: {
        targetId: watch.targetId,
        jobId: 'j1',
        reason: 'scheduled',
        scheduledFor: new Date(now - 60 * DAY),
        startedAt: new Date(now - 60 * DAY),
        finishedAt: new Date(now - 60 * DAY),
        outcome: 'ok',
      },
    });
    const point = (from: number, to: number, price: number) => ({
      targetId: watch.targetId,
      firstSeenAt: new Date(now - from * DAY),
      lastSeenAt: new Date(now - to * DAY),
      price: BigInt(price),
      currency: 'GBP',
      inStock: true,
      firstCheckId: check.id,
    });
    await h.db.pricePoint.createMany({
      data: [point(90, 50, 4000), point(50, 10, 3500), point(10, 0, 3200)],
    });

    const [listed] = (await me.list()).json().watches;
    expect(listed.history.map((p: { price: number }) => p.price)).toEqual([3500, 3200]);
    // The price held from 50 days ago, so the line starts at the window's left edge.
    const start = Date.parse(listed.history[0].t);
    expect(Math.abs(start - (now - 30 * DAY))).toBeLessThan(60_000);

    // The product page has all of it.
    const detail = (await me.get(watch.id)).json();
    expect(detail.watch.history).toHaveLength(3);
  });

  it('lists only your own products', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    await mine.add({ url: MUG });
    await theirs.add({ url: 'https://fickle.example.com/p/teapot' });
    const labels = (await mine.list()).json().watches.map((w: { label: string }) => w.label);
    expect(labels).toEqual(['Stoneware mug']);
  });
});

describe('another workspace’s products', () => {
  it('can’t be read, changed, checked or deleted, and look exactly like missing ones', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    const { watch } = (await mine.add({ url: MUG })).json();

    const attempts = [
      theirs.get(watch.id),
      theirs.get(watch.id, '/checks'),
      theirs.update(watch.id, { label: 'Mine now' }),
      theirs.checkNow(watch.id),
      theirs.remove(watch.id),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'We couldn’t find that product.' });
    }
    expect((await mine.get('not-an-id')).statusCode).toBe(404);
    expect((await mine.get(watch.id)).json().watch.label).toBe('Stoneware mug');
  });
});

describe('changing a product', () => {
  it('pauses the page when its only watcher pauses it, and wakes it on resume', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    h.wake.mockClear();

    const paused = (await me.update(watch.id, { paused: true })).json().watch;
    expect(paused.status).toBe('paused');
    expect((await target(watch.targetId)).status).toBe('paused');

    await me.update(watch.id, { paused: false });
    expect((await target(watch.targetId)).status).toBe('active');
    expect(h.wake).toHaveBeenCalledOnce();
  });

  it('clears a label and a target', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG, label: 'Gift', targetPrice: 3000 })).json();
    const changed = (await me.update(watch.id, { label: '', targetPrice: null })).json().watch;
    expect(changed).toMatchObject({ label: 'Stoneware mug', targetPrice: null });
  });

  it('refuses fields it doesn’t know', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    expect((await me.update(watch.id, { workspaceId: 'x' })).statusCode).toBe(422);
  });
});

describe('deleting a product', () => {
  it('keeps the page and its history, paused until someone watches it again', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    expect((await me.remove(watch.id)).statusCode).toBe(204);
    expect(await h.db.watch.count()).toBe(0);
    expect((await target(watch.targetId)).status).toBe('paused');

    const again = (await me.add({ url: MUG })).json().watch;
    expect(again.targetId).toBe(watch.targetId);
    expect((await target(watch.targetId)).status).toBe('active');
  });
});

describe('check now', () => {
  it('makes the page due and wakes the dispatcher', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    await h.db.target.update({
      where: { id: watch.targetId },
      data: { nextCheckAt: new Date(Date.now() + DAY), lastCheckedAt: new Date(Date.now() - DAY) },
    });
    h.wake.mockClear();

    expect((await me.checkNow(watch.id)).statusCode).toBe(202);
    expect((await target(watch.targetId)).nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(h.wake).toHaveBeenCalledOnce();
  });

  it('waits a minute after the last check', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    await h.db.target.update({
      where: { id: watch.targetId },
      data: { lastCheckedAt: new Date(Date.now() - 20_000) },
    });
    const response = await me.checkNow(watch.id);
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(35);
  });

  it('won’t check a paused product', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    await me.update(watch.id, { paused: true });
    expect((await me.checkNow(watch.id)).statusCode).toBe(409);
  });
});

describe('a product’s timeline and checks', () => {
  it('includes the site’s redesigns as well as the product’s own events', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    const { siteId } = await target(watch.targetId);
    await h.db.event.createMany({
      data: [
        { siteId, kind: 'layout_changed', at: new Date(Date.now() - 2_000) },
        { siteId, targetId: watch.targetId, kind: 'out_of_stock', at: new Date() },
      ],
    });
    const { events } = (await me.get(watch.id)).json();
    expect(events.map((e: { kind: string; siteWide: boolean }) => [e.kind, e.siteWide])).toEqual([
      ['out_of_stock', false],
      ['layout_changed', true],
    ]);
  });

  it('lists checks newest first', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    const base = Date.now() - 10 * 60_000;
    await h.db.check.createMany({
      data: [0, 1, 2].map((i) => ({
        targetId: watch.targetId,
        jobId: `job-${i}`,
        reason: 'scheduled' as const,
        mode: 'http' as const,
        scheduledFor: new Date(base + i * 60_000),
        startedAt: new Date(base + i * 60_000),
        finishedAt: new Date(base + i * 60_000 + 80),
        outcome: 'ok' as const,
        price: BigInt(3000 + i),
        currency: 'GBP',
        timings: { robots: 0, http: 80, browser: 0, total: 80 },
      })),
    });
    const { checks } = (await me.get(watch.id, '/checks?limit=2')).json();
    expect(checks.map((c: { price: number }) => c.price)).toEqual([3002, 3001]);
    expect(checks[0].timings.http).toBe(80);
  });
});

describe('labelFromUrl', () => {
  it.each([
    ['https://shop.example.com/p/stoneware-mug', 'Stoneware mug'],
    ['https://shop.example.com/products/blue_kettle.html', 'Blue kettle'],
    ['https://shop.example.com/', 'shop.example.com'],
    ['https://shop.example.com/p/%E0%A4%A', '%E0%A4%A'],
  ])('%s reads as %s', (url, label) => {
    expect(labelFromUrl(url)).toBe(label);
  });
});
