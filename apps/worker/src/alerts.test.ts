import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { channelKey, seal, type ChannelSettings, type Email } from '@pennydrop/alerts';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { QUEUES, redisConnection, type LiveMessage } from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BREAK_AFTER,
  HOURLY_CAP,
  deliver,
  evaluate,
  sendSummaries,
  type NotifyJob,
  type SenderDeps,
} from './alerts.ts';

const db = testDb('worker');
const connection = redisConnection();
const key = channelKey('test-channels-key');
const NOW = Date.UTC(2026, 9, 22, 12, 0); // 13:00 in London, 17:30 in Kolkata
let notify: Queue<NotifyJob>;
let published: LiveMessage[];
let mailed: Email[];
let serial = 0;

// A receiver that answers whatever status its path asks for.
let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => res.writeHead(Number(req.url?.split('/')[1]) || 200).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDatabase(db);
  notify = new Queue<NotifyJob>(QUEUES.notify, { connection, prefix: `test-${randomUUID()}` });
  published = [];
  mailed = [];
});
afterEach(async () => {
  await notify.obliterate({ force: true });
  await notify.close();
});
afterAll(async () => {
  server.close();
  await db.$disconnect();
  await connection.quit();
});

const deps = () => ({
  db,
  notify,
  publish: async (m: LiveMessage) => void published.push(m),
  now: () => NOW,
});
const sender = (): SenderDeps => ({
  db,
  key,
  appUrl: 'https://pennydrop.example.com',
  mail: async (email) => void mailed.push(email),
  publish: async () => {},
  now: () => NOW,
  send: {
    mail: async (email) => void mailed.push(email),
    guard: { allowPrivate: (host) => host === '127.0.0.1' },
    userAgent: 'test',
    timeoutMs: 2_000,
  },
});

async function setup(
  options: { quiet?: [number, number]; digest?: boolean; channels?: ChannelSettings[] } = {},
) {
  const user = await db.user.create({
    data: {
      id: randomUUID(),
      name: 'Prabhjot',
      email: `p${++serial}@example.com`,
      emailVerified: true,
    },
  });
  const channels = options.channels ?? [{ kind: 'email', address: user.email }];
  const workspace = await db.workspace.create({
    data: {
      name: 'W',
      quietFrom: options.quiet?.[0] ?? null,
      quietUntil: options.quiet?.[1] ?? null,
      digest: options.digest ?? false,
      memberships: { create: { userId: user.id, role: 'owner' } },
      channels: {
        create: channels.map((settings, i) => ({
          kind: settings.kind,
          name: `Channel ${i}`,
          settings: seal(settings, key),
          hint: 'x',
        })),
      },
    },
  });
  const site = await db.site.upsert({
    where: { host: 'fickle.example.com' },
    create: { host: 'fickle.example.com', registrable: 'example.com' },
    update: {},
  });
  return { user, workspace, site };
}

async function page(siteId: string, path = `p${++serial}`) {
  return db.target.create({
    data: { siteId, url: `https://fickle.example.com/${path}`, canonicalUrl: `${path}-${serial}` },
  });
}

/** A new price on a page, as ingest writes it, then the rules on it. */
async function price(targetId: string, amount: number | null, minutes: number, inStock = true) {
  const at = new Date(NOW + minutes * 60_000);
  const check = await db.check.create({
    data: {
      targetId,
      jobId: `j${++serial}`,
      reason: 'scheduled',
      scheduledFor: at,
      startedAt: at,
      finishedAt: at,
      outcome: 'ok',
    },
  });
  const point = await db.pricePoint.create({
    data: {
      targetId,
      firstSeenAt: at,
      lastSeenAt: at,
      price: amount === null ? null : BigInt(amount),
      currency: 'GBP',
      inStock,
      firstCheckId: check.id,
    },
  });
  await db.target.update({
    where: { id: targetId },
    data: { currentPrice: amount === null ? null : BigInt(amount), currency: 'GBP' },
  });
  return point;
}

describe('evaluate', () => {
  it('alerts once on reaching the target, not again while it hovers, and again after a climb past the margin', async () => {
    const { workspace, site } = await setup();
    const target = await page(site.id);
    const watch = await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: target.id,
        targetPrice: 3500n,
        rules: { create: { kind: 'below_target' } },
      },
    });
    const alerted = [];
    for (const [i, amount] of [4000, 3499, 3450, 3520, 3490, 3600, 3400].entries()) {
      const point = await price(target.id, amount, i);
      alerted.push((await evaluate(deps(), point.id)).alerts);
    }
    // 3499 alerts; 3450, 3520 (within 2%) and 3490 don't; 3600 re-arms; 3400 alerts again.
    expect(alerted).toEqual([0, 1, 0, 0, 0, 0, 1]);
    const alerts = await db.alert.findMany({
      where: { watchId: watch.id },
      orderBy: { firedAt: 'asc' },
    });
    expect(alerts.map((a) => a.reasons[0])).toEqual([
      'At or below your £35.00 target',
      'At or below your £35.00 target',
    ]);
  });

  it('lists every rule a change meets in one alert, with one delivery per channel', async () => {
    const { workspace, site } = await setup({
      channels: [
        { kind: 'email', address: 'a@example.com' },
        { kind: 'slack', url: `${base}/200` },
      ],
    });
    const target = await page(site.id);
    await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: target.id,
        targetPrice: 3500n,
        rules: {
          create: [
            { kind: 'below_target' },
            { kind: 'any_drop' },
            { kind: 'drop_percent', threshold: 10 },
            { kind: 'lowest_ever' },
          ],
        },
      },
    });
    await evaluate(deps(), (await price(target.id, 4000, 0)).id);
    await evaluate(deps(), (await price(target.id, 3400, 1)).id);
    const [alert] = await db.alert.findMany({ include: { deliveries: true } });
    expect(alert!.kinds.sort()).toEqual([
      'any_drop',
      'below_target',
      'drop_percent',
      'lowest_ever',
    ]);
    expect(alert!.reasons).toContain('Down 15% from £40.00');
    expect(alert!.deliveries.map((d) => d.status)).toEqual(['pending', 'pending']);
    expect(await notify.count()).toBe(2);
    expect(published).toContainEqual({ type: 'alert', workspaceId: workspace.id });
  });

  it('sends exactly one alert to each channel, however many workers process the same price at once', async () => {
    const { workspace, site } = await setup({
      channels: [
        { kind: 'email', address: 'a@example.com' },
        { kind: 'slack', url: `${base}/200` },
        { kind: 'webhook', url: `${base}/200`, secret: 's' },
      ],
    });
    const target = await page(site.id);
    await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: target.id,
        targetPrice: 3500n,
        rules: { create: [{ kind: 'below_target' }, { kind: 'any_drop' }] },
      },
    });
    await evaluate(deps(), (await price(target.id, 4000, 0)).id);
    const drop = await price(target.id, 3000, 1);

    const results = await Promise.all(Array.from({ length: 10 }, () => evaluate(deps(), drop.id)));
    expect(results.reduce((sum, r) => sum + r.alerts, 0)).toBe(1);
    expect(await db.alert.count()).toBe(1);
    expect(await db.delivery.count()).toBe(3);
    // And one send queued per delivery.
    expect(await notify.count()).toBe(3);
  });

  it('says so when a big jump was seen twice before alerting', async () => {
    const { workspace, site } = await setup();
    const target = await page(site.id);
    await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: target.id,
        rules: { create: { kind: 'any_drop' } },
      },
    });
    await price(target.id, 4000, 0);
    await evaluate(deps(), (await price(target.id, 3900, 1)).id);
    // Down by more than half: ingest records it only once a second check agrees.
    await evaluate(deps(), (await price(target.id, 1500, 2)).id);
    const alerts = await db.alert.findMany({ orderBy: { price: 'desc' } });
    expect(alerts.map((a) => a.verified)).toEqual([false, true]);
  });

  it('ignores a price that arrives after a newer one, and history rebuilt for the demo', async () => {
    const { workspace, site } = await setup();
    const target = await page(site.id);
    await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: target.id,
        rules: { create: { kind: 'any_drop' } },
      },
    });
    await price(target.id, 4000, 0);
    const late = await price(target.id, 3000, 1);
    await price(target.id, 3100, 2);
    expect((await evaluate(deps(), late.id)).alerts).toBe(0);
    const replayed = await price(target.id, 2000, 3);
    await db.pricePoint.update({ where: { id: replayed.id }, data: { replayed: true } });
    expect((await evaluate(deps(), replayed.id)).alerts).toBe(0);
  });

  it('tells you when a rival in the group undercuts your own listing', async () => {
    const { workspace, site } = await setup();
    const yours = await page(site.id, 'p/yours');
    const theirs = await page(site.id, 'p/theirs');
    const group = await db.productGroup.create({
      data: { workspaceId: workspace.id, name: 'Kettle' },
    });
    await price(yours.id, 5000, 0);
    await price(theirs.id, 5500, 0);
    const mine = await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: yours.id,
        groupId: group.id,
        isMine: true,
        rules: { create: { kind: 'undercut' } },
      },
    });
    await db.watch.create({
      data: { workspaceId: workspace.id, targetId: theirs.id, groupId: group.id },
    });

    expect((await evaluate(deps(), (await price(theirs.id, 4800, 1)).id)).alerts).toBe(1);
    const [alert] = await db.alert.findMany({ where: { watchId: mine.id } });
    expect(alert!.reasons).toEqual(['fickle.example.com is now £48.00, £2.00 under your listing']);
    // Still cheaper: no second alert until it isn't.
    expect((await evaluate(deps(), (await price(theirs.id, 4700, 2)).id)).alerts).toBe(0);
  });

  it('holds alerts during quiet hours, for the digest, and past the hourly cap', async () => {
    // 22:00 to 15:00 London time covers 13:00 now: held until 15:00 (14:00 UTC in October).
    const quiet = await setup({ quiet: [22 * 60, 15 * 60] });
    const target = await page(quiet.site.id);
    await db.watch.create({
      data: {
        workspaceId: quiet.workspace.id,
        targetId: target.id,
        rules: { create: { kind: 'any_drop' } },
      },
    });
    await evaluate(deps(), (await price(target.id, 4000, 0)).id);
    await evaluate(deps(), (await price(target.id, 3900, 1)).id);
    const held = await db.delivery.findFirstOrThrow();
    expect(held).toMatchObject({ status: 'batched', heldFor: 'during your quiet hours' });
    expect(held.sendAfter?.toISOString()).toBe('2026-10-22T14:00:00.000Z');

    const digest = await setup({ digest: true });
    const other = await page(digest.site.id);
    await db.watch.create({
      data: {
        workspaceId: digest.workspace.id,
        targetId: other.id,
        rules: { create: { kind: 'any_drop' } },
      },
    });
    await evaluate(deps(), (await price(other.id, 4000, 0)).id);
    await evaluate(deps(), (await price(other.id, 3900, 1)).id);
    const daily = await db.delivery.findFirstOrThrow({
      where: { channel: { workspaceId: digest.workspace.id } },
    });
    expect(daily).toMatchObject({ status: 'batched', heldFor: 'in your daily digest' });
    // 08:00 tomorrow in London: 07:00 UTC.
    expect(daily.sendAfter?.toISOString()).toBe('2026-10-23T07:00:00.000Z');
  });

  it('caps deliveries per channel per hour', async () => {
    const { workspace, site } = await setup();
    const targets = await Promise.all(Array.from({ length: HOURLY_CAP + 2 }, () => page(site.id)));
    for (const target of targets) {
      await db.watch.create({
        data: {
          workspaceId: workspace.id,
          targetId: target.id,
          rules: { create: { kind: 'any_drop' } },
        },
      });
      await price(target.id, 4000, 0);
    }
    for (const target of targets) await evaluate(deps(), (await price(target.id, 3000, 1)).id);
    const statuses = (await db.delivery.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (d) => d.status,
    );
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(HOURLY_CAP);
    expect(statuses.filter((s) => s === 'batched')).toHaveLength(2);
  });
});

describe('deliver', () => {
  async function oneDelivery(settings: ChannelSettings) {
    const { workspace, site, user } = await setup({ channels: [settings] });
    const target = await page(site.id);
    await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: target.id,
        label: 'Kettle',
        rules: { create: { kind: 'any_drop' } },
      },
    });
    await evaluate(deps(), (await price(target.id, 4000, 0)).id);
    await evaluate(deps(), (await price(target.id, 3900, 1)).id);
    const delivery = await db.delivery.findFirstOrThrow();
    return { delivery, user };
  }

  it('sends once, and does nothing if asked again', async () => {
    const { delivery } = await oneDelivery({ kind: 'email', address: 'a@example.com' });
    expect(await deliver(sender(), delivery.id)).toBe('sent');
    expect(await deliver(sender(), delivery.id)).toBe('skipped');
    expect(mailed).toHaveLength(1);
    expect(mailed[0]!.subject).toContain('Kettle: £39.00');
    expect(await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: 'sent',
      attempts: 1,
    });
  });

  it('retries a receiver having a bad moment', async () => {
    const { delivery } = await oneDelivery({ kind: 'slack', url: `${base}/503` });
    await expect(deliver(sender(), delivery.id)).rejects.toThrow('The receiver answered 503.');
    expect(await db.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: 'pending',
      attempts: 1,
    });
  });

  it('gives up on a revoked webhook, and after three, marks the channel broken and tells its owner once', async () => {
    const settings: ChannelSettings = { kind: 'slack', url: `${base}/404` };
    const { delivery, user } = await oneDelivery(settings);
    expect(await deliver(sender(), delivery.id)).toBe('failed');
    const channelId = delivery.channelId;
    // Two more failures on the same channel.
    for (let i = 0; i < BREAK_AFTER - 1; i++) {
      const watch = await db.watch.findFirstOrThrow();
      const point = await price(watch.targetId, 3800 - i * 100, 10 + i);
      await evaluate(deps(), point.id);
      const next = await db.delivery.findFirstOrThrow({ where: { status: 'pending' } });
      await deliver(sender(), next.id);
    }
    const channel = await db.channel.findUniqueOrThrow({ where: { id: channelId } });
    expect(channel).toMatchObject({ status: 'broken', failures: BREAK_AFTER });
    expect(mailed.filter((m) => m.to === user.email)).toHaveLength(1);
    expect(mailed[0]!.subject).toBe('Your “Channel 0” alerts have stopped working');

    // While it's broken, new alerts skip it.
    const watch = await db.watch.findFirstOrThrow();
    await evaluate(deps(), (await price(watch.targetId, 3000, 30)).id);
    expect(await db.delivery.count({ where: { status: 'skipped' } })).toBe(1);
  });
});

describe('sendSummaries', () => {
  it('sends what was held back as one message per channel', async () => {
    const { workspace, site } = await setup({ quiet: [22 * 60, 15 * 60] });
    for (const amount of [3900, 3800]) {
      const target = await page(site.id);
      await db.watch.create({
        data: {
          workspaceId: workspace.id,
          targetId: target.id,
          rules: { create: { kind: 'any_drop' } },
        },
      });
      await price(target.id, 4000, 0);
      await evaluate(deps(), (await price(target.id, amount, 1)).id);
    }
    // Not yet: quiet hours haven't ended.
    expect(await sendSummaries(sender())).toBe(0);
    const later = { ...sender(), now: () => NOW + 2 * 3_600_000 };
    expect(await sendSummaries(later)).toBe(2);
    expect(mailed).toHaveLength(1);
    expect(mailed[0]!.subject).toBe('2 price alerts during your quiet hours');
    expect(await db.delivery.count({ where: { status: 'sent' } })).toBe(2);
  });
});
