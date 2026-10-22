import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';
import { unzip } from '../test/unzip.ts';

const h = harness();
beforeEach(async () => {
  h.sent.length = 0;
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

const PASSWORD = 'correct horse battery';
const post = (url: string, payload: object, cookie?: string) =>
  h.app.inject({
    method: 'POST',
    url,
    headers: { origin: APP_URL, ...(cookie ? { cookie } : {}) },
    payload,
  });

describe('forgotten passwords', () => {
  it('emails a link, sets a new password from it, and signs out everywhere else', async () => {
    const cookie = await h.signIn('p@example.com');
    h.sent.length = 0;
    expect(
      (
        await post('/api/auth/request-password-reset', {
          email: 'p@example.com',
          redirectTo: '/reset',
        })
      ).statusCode,
    ).toBe(200);
    const message = h.sent.find((m) => m.subject === 'Reset your Pennydrop password');
    const link = new URL(/https?:\/\/\S+/.exec(message!.text)![0]);

    // The link checks the token, then sends the browser to the app's reset page with it.
    const opened = await h.app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
    expect(opened.statusCode).toBe(302);
    const token = new URL(opened.headers.location as string, APP_URL).searchParams.get('token');
    expect(token).toBeTruthy();

    const reset = await post('/api/auth/reset-password', {
      newPassword: 'a different long one',
      token,
    });
    expect(reset.statusCode).toBe(200);
    expect(
      (await post('/api/auth/sign-in/email', { email: 'p@example.com', password: PASSWORD }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await post('/api/auth/sign-in/email', {
          email: 'p@example.com',
          password: 'a different long one',
        })
      ).statusCode,
    ).toBe(200);
    // The session from before the reset no longer works.
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode,
    ).toBe(401);
  });

  it('answers the same whether or not there’s an account, so it can’t be used to find them', async () => {
    const response = await post('/api/auth/request-password-reset', {
      email: 'nobody@example.com',
      redirectTo: '/reset',
    });
    expect(response.statusCode).toBe(200);
    expect(h.sent).toEqual([]);
  });
});

describe('deleting an account', () => {
  it('takes its workspace and watches, and leaves other people’s alone', async () => {
    const mine = await h.signIn('a@example.com');
    const theirs = await h.signIn('b@example.com');
    const add = (cookie: string, url: string) =>
      post('/api/watches', { url }, cookie).then((r) => r.json().watch);
    const shared = await add(mine, 'https://fickle.example.com/p/kettle');
    await add(theirs, 'https://fickle.example.com/p/kettle');
    const alone = await add(mine, 'https://fickle.example.com/p/lamp');

    const deleted = await post('/api/auth/delete-user', { password: PASSWORD }, mine);
    expect(deleted.statusCode).toBe(200);

    expect(await h.db.user.findUnique({ where: { email: 'a@example.com' } })).toBeNull();
    expect(await h.db.workspace.count()).toBe(1);
    expect(await h.db.watch.count()).toBe(1);
    // A page someone else still watches carries on; one nobody watches is paused, history kept.
    const statuses = await h.db.target.findMany({ select: { id: true, status: true } });
    expect(statuses.find((t) => t.id === shared.targetId)?.status).toBe('active');
    expect(statuses.find((t) => t.id === alone.targetId)?.status).toBe('paused');
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: mine } })).statusCode,
    ).toBe(401);
  });

  it('wants the password first', async () => {
    const mine = await h.signIn('a@example.com');
    const response = await post('/api/auth/delete-user', { password: 'not the password' }, mine);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(await h.db.user.findUnique({ where: { email: 'a@example.com' } })).not.toBeNull();
  });
});

describe('GET /api/export', () => {
  it('gives the workspace’s products, their price history and its alerts in one ZIP', async () => {
    const cookie = await h.signIn();
    const { watch } = (
      await post('/api/watches', { url: 'https://fickle.example.com/p/mug', label: 'Mug' }, cookie)
    ).json();
    const at = new Date('2026-10-01T09:00:00Z');
    const check = await h.db.check.create({
      data: {
        targetId: watch.targetId,
        jobId: 'j',
        reason: 'scheduled',
        scheduledFor: at,
        startedAt: at,
        finishedAt: at,
        outcome: 'ok',
      },
    });
    const point = await h.db.pricePoint.create({
      data: {
        targetId: watch.targetId,
        firstSeenAt: at,
        lastSeenAt: at,
        price: 3450n,
        currency: 'GBP',
        inStock: true,
        firstCheckId: check.id,
      },
    });
    const { workspaceId } = await h.db.watch.findUniqueOrThrow({ where: { id: watch.id } });
    // Signing up made an email channel.
    const [channel] = await h.db.channel.findMany({ where: { workspaceId } });
    await h.db.alert.create({
      data: {
        workspaceId,
        watchId: watch.id,
        pricePointId: point.id,
        kinds: ['below_target', 'any_drop'],
        price: 3450n,
        previousPrice: 3900n,
        currency: 'GBP',
        reasons: ['At or below your £35.00 target', 'Down £4.50 from £39.00'],
        firedAt: at,
        deliveries: { create: { channelId: channel!.id, status: 'sent' } },
      },
    });

    const response = await h.app.inject({ method: 'GET', url: '/api/export', headers: { cookie } });
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toMatch(
      /pennydrop-export-\d{4}-\d{2}-\d{2}\.zip/,
    );
    const files = unzip(response.rawPayload);
    expect(Object.keys(files)).toEqual(['products.csv', 'price-history.csv', 'alerts.csv']);
    expect(files['products.csv']).toContain(
      'Mug,fickle.example.com,https://fickle.example.com/p/mug',
    );
    expect(files['price-history.csv']!.split('\r\n')[1]).toBe(
      'Mug,https://fickle.example.com/p/mug,2026-10-01T09:00:00.000Z,2026-10-01T09:00:00.000Z,34.50,,GBP,true',
    );
    // The channel's name and what happened, never its address.
    expect(files['alerts.csv']!.split('\r\n')[1]).toBe(
      `2026-10-01T09:00:00.000Z,Mug,https://fickle.example.com/p/mug,34.50,39.00,GBP,below_target; any_drop,At or below your £35.00 target; Down £4.50 from £39.00,false,,${channel!.name}: sent`,
    );
  });
});
