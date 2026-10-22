import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

const h = harness();
beforeEach(async () => {
  h.sent.length = 0;
  h.shop.settings.clear();
  h.shop.changes.length = 0;
  h.wake.mockClear();
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

const startDemo = (cookie?: string) =>
  h.app.inject({
    method: 'POST',
    url: '/api/demo',
    headers: { origin: APP_URL, ...(cookie ? { cookie } : {}) },
  });

function as(cookie: string) {
  const headers = { cookie, origin: APP_URL };
  return (method: 'GET' | 'POST', url: string, payload?: object) =>
    h.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
}

/** Fickle's vase and mug as the showcase finds them: read before, at known prices. */
async function practiceShopsKnown() {
  const site = await h.db.site.create({
    data: { host: 'fickle.localhost', registrable: 'fickle.localhost', demoAllowed: true },
  });
  for (const [slug, price] of [
    ['ribbed-vase', 2399n],
    ['stoneware-mug', 1800n],
  ] as const) {
    const url = `http://fickle.localhost:4000/p/${slug}`;
    await h.db.target.create({
      data: { siteId: site.id, url, canonicalUrl: url, currentPrice: price, currency: 'GBP' },
    });
  }
}

describe('starting the demo', () => {
  it('signs a visitor in with one click, to a workspace of their own that ends in a day', async () => {
    await practiceShopsKnown();
    const started = await startDemo();
    expect(started.statusCode).toBe(201);
    const cookie = h.cookiesFrom(started.headers['set-cookie']);
    expect(cookie).toContain('pennydrop.session_token');
    const me = as(cookie);

    const { workspace, user } = (await me('GET', '/api/me')).json();
    expect(user.name).toBe('Demo visitor');
    expect(workspace).toMatchObject({ name: 'Demo', isDemo: true });
    const hours = (Date.parse(workspace.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    // No account email, so no channels: alerts land in the inbox.
    expect((await me('GET', '/api/channels')).json().channels).toEqual([]);
    expect(h.wake).toHaveBeenCalled();
  });

  it('watches the showcase, compared and with targets, and one product in a shop of its own', async () => {
    await practiceShopsKnown();
    const me = as(h.cookiesFrom((await startDemo()).headers['set-cookie']));
    const { watches } = (await me('GET', '/api/watches')).json();
    const byUrl = (part: string) =>
      watches.find((w: { url: string }) => w.url.includes(part)) as Record<string, unknown>;
    expect(watches).toHaveLength(6);
    expect(byUrl('fickle.localhost:4000/p/copper-kettle')).toMatchObject({ isMine: true });
    expect(byUrl('brittle.localhost:4000/p/copper-kettle').groupId).toBe(
      byUrl('fickle.localhost:4000/p/copper-kettle').groupId,
    );
    // 10% under £23.99, in 50p steps.
    expect(byUrl('ribbed-vase')).toMatchObject({ targetPrice: 2150 });
    const sandbox = byUrl('/p/stoneware-mug');
    expect(sandbox.url).toMatch(
      /^http:\/\/sandbox-[0-9a-f]{16}\.localhost:4000\/p\/stoneware-mug$/,
    );
    // The same mug as Fickle's, so the same price: a target 10% under it, and checked at once.
    expect(sandbox).toMatchObject({ targetPrice: 1600, label: 'Stoneware mug, in your own shop' });
    const target = await h.db.target.findUniqueOrThrow({
      where: { canonicalUrl: sandbox.url as string },
      include: { site: true },
    });
    expect(target.nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(target.site).toMatchObject({ demoAllowed: true, minGapMs: 1_000 });
  });

  it('carries on in the same demo, and won’t sign out someone signed in to their account', async () => {
    const cookie = h.cookiesFrom((await startDemo()).headers['set-cookie']);
    const again = await startDemo(cookie);
    expect(again.statusCode).toBe(200);
    expect(await h.db.workspace.count({ where: { isDemo: true } })).toBe(1);

    const account = await h.signIn();
    expect((await startDemo(account)).statusCode).toBe(409);
  });

  it('only starts from Pennydrop itself, and never through Better Auth directly', async () => {
    expect((await h.app.inject({ method: 'POST', url: '/api/demo', headers: {} })).statusCode).toBe(
      403,
    );
    const direct = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/anonymous',
      headers: { origin: APP_URL },
    });
    expect(direct.statusCode).toBe(404);
    expect(await h.db.user.count()).toBe(0);
  });
});

describe('a demo workspace', () => {
  it('breaks its own shop, and checks it straight away', async () => {
    const me = as(h.cookiesFrom((await startDemo()).headers['set-cookie']));
    h.wake.mockClear();
    const broken = await me('POST', '/api/demo/break', { action: 'redesign' });
    expect(broken.json().state).toMatchObject({ redesigned: true, slow: false });
    const [change] = h.shop.changes;
    expect(change!.host).toMatch(/^sandbox-[0-9a-f]{16}\.localhost:4000$/);
    expect(change!.patch).toEqual({ layout: 'redesign' });
    expect(h.wake).toHaveBeenCalled();

    await me('POST', '/api/demo/break', { action: 'sale' });
    const { sandbox, expiresAt } = (await me('GET', '/api/demo')).json();
    expect(expiresAt).toBeTruthy();
    expect(sandbox.state).toEqual({
      redesigned: true,
      slow: false,
      failing: false,
      soldOut: false,
      onSale: true,
    });
    expect((await me('POST', '/api/demo/break', { action: 'fix' })).json().state.redesigned).toBe(
      false,
    );
    expect((await me('POST', '/api/demo/break', { action: 'explode' })).statusCode).toBe(422);
  });

  it('adds only practice-shop products, and sends alerts by email only', async () => {
    const me = as(h.cookiesFrom((await startDemo()).headers['set-cookie']));
    const outside = await me('POST', '/api/watches', { url: 'https://shop.example.com/p/kettle' });
    expect(outside.statusCode).toBe(422);
    const slack = await me('POST', '/api/channels', {
      kind: 'slack',
      name: 'Slack',
      url: 'https://hooks.slack.com/services/example/channel/token',
    });
    expect(slack.json()).toMatchObject({ error: 'The demo sends alerts by email only.' });
    const email = await me('POST', '/api/channels', {
      kind: 'email',
      name: 'Me',
      address: 'visitor@example.com',
    });
    expect(email.statusCode).toBe(201);
  });

  it('ends when it expires, before the nightly clean-up deletes it', async () => {
    const me = as(h.cookiesFrom((await startDemo()).headers['set-cookie']));
    await h.db.workspace.updateMany({
      where: { isDemo: true },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const ended = await me('GET', '/api/watches');
    expect(ended.statusCode).toBe(401);
    expect(ended.json().error).toBe('This demo has ended. Start another any time.');
  });

  it('isn’t something an ordinary workspace has', async () => {
    const me = as(await h.signIn());
    expect((await me('GET', '/api/demo')).statusCode).toBe(404);
    expect((await me('POST', '/api/demo/break', { action: 'sale' })).statusCode).toBe(404);
  });
});
