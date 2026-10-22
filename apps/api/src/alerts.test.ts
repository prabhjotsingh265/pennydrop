import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

const h = harness();
beforeEach(async () => {
  h.sent.length = 0;
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

function as(cookie: string) {
  const headers = { cookie, origin: APP_URL };
  return (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    h.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
}
// A placeholder, not a secret: real webhook addresses only ever live in .env.
const SLACK = 'https://hooks.slack.com/services/example/channel/token';

describe('channels', () => {
  it('starts every account with an email channel to its own address', async () => {
    const me = as(await h.signIn('p@example.com'));
    const { channels } = (await me('GET', '/api/channels')).json();
    expect(channels).toEqual([
      expect.objectContaining({
        kind: 'email',
        name: 'My email',
        hint: 'p@example.com',
        status: 'active',
      }),
    ]);
  });

  it('keeps a Slack address sealed, and shows only enough to recognise it', async () => {
    const me = as(await h.signIn());
    const created = await me('POST', '/api/channels', { kind: 'slack', name: 'Team', url: SLACK });
    expect(created.statusCode).toBe(201);
    expect(created.json().channel.hint).toBe('hooks.slack.com/…/oken');
    const stored = await h.db.channel.findFirstOrThrow({ where: { kind: 'slack' } });
    expect(stored.settings).not.toContain('hooks.slack.com');
    expect(JSON.stringify((await me('GET', '/api/channels')).json())).not.toContain(
      'services/example',
    );
  });

  it('refuses addresses that aren’t what they say', async () => {
    const me = as(await h.signIn());
    const fake = await me('POST', '/api/channels', {
      kind: 'slack',
      name: 'x',
      url: 'https://evil.example.com/services/x',
    });
    expect(fake.statusCode).toBe(422);
    expect(fake.json().error).toMatch(/hooks\.slack\.com/);
    expect(
      (await me('POST', '/api/channels', { kind: 'email', name: 'x', address: 'nope' })).statusCode,
    ).toBe(422);
  });

  it('shows a webhook’s signing secret once, when it’s made', async () => {
    const me = as(await h.signIn());
    const created = (
      await me('POST', '/api/channels', {
        kind: 'webhook',
        name: 'Hook',
        url: 'https://receiver.example.com/hook',
      })
    ).json();
    expect(created.secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await me('GET', '/api/channels')).json())).not.toContain(created.secret);
  });

  it('sends a test, and says why when it can’t', async () => {
    const me = as(await h.signIn('p@example.com'));
    const { channels } = (await me('GET', '/api/channels')).json();
    h.sent.length = 0;
    expect((await me('POST', `/api/channels/${channels[0].id}/test`)).json()).toEqual({ ok: true });
    expect(h.sent[0]).toMatchObject({
      to: 'p@example.com',
      subject: expect.stringContaining('A test from Pennydrop'),
    });

    // A webhook pointing into a private network is refused when it would send.
    const hook = (
      await me('POST', '/api/channels', {
        kind: 'webhook',
        name: 'Inside',
        url: 'https://10.0.0.5/hook',
      })
    ).json();
    const tried = (await me('POST', `/api/channels/${hook.channel.id}/test`)).json();
    expect(tried).toEqual({ ok: false, error: 'That address is inside a private network.' });
  });

  it('keeps each workspace’s channels to itself', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    const { channels } = (await mine('GET', '/api/channels')).json();
    expect((await theirs('POST', `/api/channels/${channels[0].id}/test`)).statusCode).toBe(404);
    expect((await theirs('DELETE', `/api/channels/${channels[0].id}`)).statusCode).toBe(404);
    expect((await mine('DELETE', `/api/channels/${channels[0].id}`)).statusCode).toBe(204);
  });
});

describe('rules', () => {
  it('comes with "below my target" when a target is set, on adding or later', async () => {
    const me = as(await h.signIn());
    const withTarget = (
      await me('POST', '/api/watches', {
        url: 'https://fickle.example.com/p/mug',
        targetPrice: 3000,
      })
    ).json().watch;
    expect((await me('GET', `/api/watches/${withTarget.id}/rules`)).json().rules).toEqual([
      expect.objectContaining({ kind: 'below_target', armed: true }),
    ]);
    const without = (
      await me('POST', '/api/watches', { url: 'https://fickle.example.com/p/lamp' })
    ).json().watch;
    expect((await me('GET', `/api/watches/${without.id}/rules`)).json().rules).toEqual([]);
    await me('PATCH', `/api/watches/${without.id}`, { targetPrice: 2000 });
    expect((await me('GET', `/api/watches/${without.id}/rules`)).json().rules).toHaveLength(1);
  });

  it('turns rules on and off, and "drops by" needs its percentage', async () => {
    const me = as(await h.signIn());
    const watch = (
      await me('POST', '/api/watches', { url: 'https://fickle.example.com/p/mug' })
    ).json().watch;
    expect((await me('PUT', `/api/watches/${watch.id}/rules/drop_percent`, {})).statusCode).toBe(
      422,
    );
    expect(
      (await me('PUT', `/api/watches/${watch.id}/rules/drop_percent`, { threshold: 15 })).json()
        .rule,
    ).toMatchObject({
      kind: 'drop_percent',
      threshold: 15,
    });
    await me('PUT', `/api/watches/${watch.id}/rules/back_in_stock`, {});
    expect(
      (await me('GET', `/api/watches/${watch.id}/rules`))
        .json()
        .rules.map((r: { kind: string }) => r.kind),
    ).toEqual(['drop_percent', 'back_in_stock']);
    expect((await me('DELETE', `/api/watches/${watch.id}/rules/drop_percent`)).statusCode).toBe(
      204,
    );
    expect((await me('GET', `/api/watches/${watch.id}/rules`)).json().rules).toHaveLength(1);
  });

  it('only hears of undercutting for your own listing', async () => {
    const me = as(await h.signIn());
    const watch = (
      await me('POST', '/api/watches', { url: 'https://fickle.example.com/p/mug' })
    ).json().watch;
    expect((await me('PUT', `/api/watches/${watch.id}/rules/undercut`, {})).statusCode).toBe(422);
    await me('PATCH', `/api/watches/${watch.id}`, { isMine: true });
    expect((await me('PUT', `/api/watches/${watch.id}/rules/undercut`, {})).statusCode).toBe(200);
    // Not yours any more: the rule goes.
    await me('PATCH', `/api/watches/${watch.id}`, { isMine: false });
    expect((await me('GET', `/api/watches/${watch.id}/rules`)).json().rules).toEqual([]);
  });

  it('keeps another workspace’s rules out of reach', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    const watch = (
      await mine('POST', '/api/watches', { url: 'https://fickle.example.com/p/mug' })
    ).json().watch;
    expect((await theirs('GET', `/api/watches/${watch.id}/rules`)).statusCode).toBe(404);
    expect((await theirs('PUT', `/api/watches/${watch.id}/rules/any_drop`, {})).statusCode).toBe(
      404,
    );
  });
});

describe('the inbox', () => {
  async function alertFor(watchId: string, targetId: string, minutesAgo: number) {
    const at = new Date(Date.now() - minutesAgo * 60_000);
    const check = await h.db.check.create({
      data: {
        targetId,
        jobId: `j${minutesAgo}`,
        reason: 'scheduled',
        scheduledFor: at,
        startedAt: at,
        finishedAt: at,
        outcome: 'ok',
      },
    });
    const point = await h.db.pricePoint.create({
      data: {
        targetId,
        firstSeenAt: at,
        lastSeenAt: at,
        price: 2999n,
        currency: 'GBP',
        inStock: true,
        firstCheckId: check.id,
      },
    });
    const watch = await h.db.watch.findUniqueOrThrow({ where: { id: watchId } });
    return h.db.alert.create({
      data: {
        workspaceId: watch.workspaceId,
        watchId,
        pricePointId: point.id,
        kinds: ['below_target'],
        price: 2999n,
        previousPrice: 3499n,
        currency: 'GBP',
        reasons: ['At or below your £30.00 target'],
        firedAt: at,
      },
    });
  }

  it('lists alerts newest first, counts the unread, and marks them read', async () => {
    const me = as(await h.signIn());
    const watch = (
      await me('POST', '/api/watches', { url: 'https://fickle.example.com/p/mug', label: 'Mug' })
    ).json().watch;
    await alertFor(watch.id, watch.targetId, 10);
    await alertFor(watch.id, watch.targetId, 5);

    const { alerts } = (await me('GET', '/api/alerts')).json();
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({
      label: 'Mug',
      price: 2999,
      previousPrice: 3499,
      reasons: ['At or below your £30.00 target'],
    });
    expect((await me('GET', '/api/alerts/unread')).json()).toEqual({ count: 2 });
    await me('POST', '/api/alerts/read', { ids: [alerts[0].id] });
    expect((await me('GET', '/api/alerts/unread')).json()).toEqual({ count: 1 });
    await me('POST', '/api/alerts/read', {});
    expect((await me('GET', '/api/alerts/unread')).json()).toEqual({ count: 0 });
  });

  it('is private to its workspace', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    const watch = (
      await mine('POST', '/api/watches', { url: 'https://fickle.example.com/p/mug' })
    ).json().watch;
    const alert = await alertFor(watch.id, watch.targetId, 1);
    expect((await theirs('GET', '/api/alerts')).json().alerts).toEqual([]);
    await theirs('POST', '/api/alerts/read', { ids: [alert.id] });
    expect((await mine('GET', '/api/alerts/unread')).json()).toEqual({ count: 1 });
  });
});

describe('quiet hours and the digest', () => {
  it('saves them with the workspace', async () => {
    const me = as(await h.signIn());
    const saved = await me('PATCH', '/api/workspace', {
      quietFrom: 22 * 60,
      quietUntil: 7 * 60,
      digest: true,
      digestAt: 8 * 60,
    });
    expect(saved.json().workspace).toMatchObject({
      quietFrom: 1320,
      quietUntil: 420,
      digest: true,
      digestAt: 480,
    });
    expect((await me('PATCH', '/api/workspace', { quietFrom: 2000 })).statusCode).toBe(422);
  });
});
