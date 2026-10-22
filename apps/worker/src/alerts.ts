import {
  compose,
  composeSummary,
  inWindow,
  judge,
  nextLocalTime,
  open,
  reasonFor,
  send,
  type AlertContent,
  type ChannelSettings,
  type Mailer,
  type SendDeps,
} from '@pennydrop/alerts';
import type { AlertRuleKind, Db, DeliveryStatus, Prisma } from '@pennydrop/db';
import type { LiveMessage } from '@pennydrop/queue';
import type { Queue } from 'bullmq';
import { isSuspicious } from './ingest.ts';

/** Deliveries per channel per hour before the rest wait for one summary. */
export const HOURLY_CAP = 20;
/** A delivery is tried this many times, over about an hour, before it's marked failed. */
export const DELIVERY_ATTEMPTS = 6;
/** Waits between tries: about 1, 3, 8, 15 and 30 minutes. */
export const RETRY_DELAYS_MS = [60_000, 180_000, 480_000, 900_000, 1_800_000];
/** Failed deliveries in a row before a channel is marked broken. */
export const BREAK_AFTER = 3;

export interface NotifyJob {
  deliveryId: string;
}

export interface AlertDeps {
  db: Db;
  notify: Queue<NotifyJob>;
  publish: (message: LiveMessage) => Promise<void>;
  now?: () => number;
}

export interface SenderDeps {
  db: Db;
  key: Buffer;
  /** Where links in messages point: the dashboard. */
  appUrl: string;
  /** For telling an owner a channel broke. */
  mail: Mailer;
  send: SendDeps;
  publish: (message: LiveMessage) => Promise<void>;
  now?: () => number;
}

const minor = (value: bigint | null) => (value === null ? null : Number(value));

/** Where a new delivery goes: now, or held for a summary (quiet hours, the digest, a busy hour). */
async function placement(
  tx: Prisma.TransactionClient,
  channelId: string,
  workspace: {
    timezone: string;
    quietFrom: number | null;
    quietUntil: number | null;
    digest: boolean;
    digestAt: number;
  },
  now: number,
): Promise<{ status: DeliveryStatus; sendAfter: Date | null; heldFor: string | null }> {
  if (workspace.digest) {
    return {
      status: 'batched',
      sendAfter: new Date(nextLocalTime(now, workspace.timezone, workspace.digestAt)),
      heldFor: 'in your daily digest',
    };
  }
  const { quietFrom, quietUntil } = workspace;
  if (
    quietFrom !== null &&
    quietUntil !== null &&
    inWindow(now, workspace.timezone, quietFrom, quietUntil)
  ) {
    return {
      status: 'batched',
      sendAfter: new Date(nextLocalTime(now, workspace.timezone, quietUntil)),
      heldFor: 'during your quiet hours',
    };
  }
  const recent = await tx.delivery.count({
    where: {
      channelId,
      status: { in: ['pending', 'sent'] },
      createdAt: { gt: new Date(now - 3_600_000) },
    },
  });
  if (recent >= HOURLY_CAP) {
    const nextHour = Math.ceil(now / 3_600_000) * 3_600_000;
    return { status: 'batched', sendAfter: new Date(nextHour), heldFor: 'from a busy hour' };
  }
  return { status: 'pending', sendAfter: null, heldFor: null };
}

/**
 * Runs every rule that could care about a new price point: the rules of each
 * product watching that page, and "undercut" on any listing sharing a group
 * with it. Each product's rules are locked while they're judged, and a product
 * gets at most one alert per price point, so however many workers process
 * the same point, each change alerts once.
 */
export async function evaluate(deps: AlertDeps, pricePointId: string) {
  const { db } = deps;
  const now = deps.now?.() ?? Date.now();
  const point = await db.pricePoint.findUnique({ where: { id: pricePointId } });
  // History rebuilt for the demo never alerts: nobody was told then, so nobody is told now.
  if (!point || point.replayed) return { alerts: 0 };
  // An old point arriving late changes nothing: only the newest price is news.
  const newest = await db.pricePoint.findFirst({
    where: { targetId: point.targetId },
    orderBy: { firstSeenAt: 'desc' },
    select: { id: true },
  });
  if (newest?.id !== point.id) return { alerts: 0 };

  const before = await db.pricePoint.findFirst({
    where: { targetId: point.targetId, firstSeenAt: { lt: point.firstSeenAt } },
    orderBy: { firstSeenAt: 'desc' },
  });
  const lowest = await db.pricePoint.aggregate({
    where: {
      targetId: point.targetId,
      firstSeenAt: { lt: point.firstSeenAt },
      price: { not: null },
    },
    _min: { price: true },
  });
  // Ingest records a suspicious jump only once a second check has seen it.
  const verified =
    point.price !== null && isSuspicious(before, { price: point.price, currency: point.currency });

  const own = await db.watch.findMany({
    where: { targetId: point.targetId, paused: false, rules: { some: {} } },
    select: { id: true },
  });
  // Your listing, undercut: watches that are "mine", in a group with this page.
  const groups = await db.watch.findMany({
    where: { targetId: point.targetId, groupId: { not: null } },
    select: { groupId: true },
  });
  const mine = await db.watch.findMany({
    where: {
      groupId: { in: groups.map((g) => g.groupId!) },
      isMine: true,
      paused: false,
      rules: { some: { kind: 'undercut' } },
    },
    select: { id: true },
  });
  const candidates = [...new Set([...own, ...mine].map((w) => w.id))];

  let alerts = 0;
  for (const watchId of candidates) {
    const made = await db.$transaction(async (tx) => {
      // One worker at a time per product; whoever comes second finds the alert made.
      await tx.$queryRaw`SELECT id FROM alert_rules WHERE watch_id = ${watchId}::uuid FOR UPDATE`;
      const done = await tx.alert.findUnique({
        where: { watchId_pricePointId: { watchId, pricePointId: point.id } },
        select: { id: true },
      });
      if (done) return null;

      const watch = await tx.watch.findUniqueOrThrow({
        where: { id: watchId },
        include: {
          rules: true,
          target: { include: { site: { select: { host: true } } } },
          workspace: { include: { channels: true } },
        },
      });
      const onThisPage = watch.targetId === point.targetId;
      const myPrice = onThisPage ? minor(point.price) : minor(watch.target.currentPrice);
      const currency = onThisPage ? point.currency : (watch.target.currency ?? point.currency);
      const rivals = watch.groupId
        ? await tx.watch.findMany({
            where: { groupId: watch.groupId, id: { not: watch.id }, paused: false },
            include: { target: { include: { site: { select: { host: true } } } } },
          })
        : [];
      const rival = rivals
        .map((r) => ({
          host: r.target.site.host,
          price: r.targetId === point.targetId ? minor(point.price) : minor(r.target.currentPrice),
          currency: r.targetId === point.targetId ? point.currency : r.target.currency,
        }))
        .filter(
          (r): r is { host: string; price: number; currency: string } =>
            r.price !== null && r.currency === currency,
        )
        .sort((a, b) => a.price - b.price)[0];

      const situation = {
        now: {
          price: myPrice,
          inStock: onThisPage ? point.inStock : (watch.target.inStock ?? true),
        },
        before:
          onThisPage && before ? { price: minor(before.price), inStock: before.inStock } : null,
        lowestBefore: onThisPage ? minor(lowest._min.price) : null,
        target: minor(watch.targetPrice),
        cheapestRival: rival?.price ?? null,
      };
      const fired: AlertRuleKind[] = [];
      for (const rule of watch.rules) {
        // Another page's price only bears on "undercut"; this page's on everything.
        if (!onThisPage && rule.kind !== 'undercut') continue;
        const verdict = judge(rule, situation);
        if (verdict.fires) fired.push(rule.kind);
        if (verdict.armed !== rule.armed || verdict.fires) {
          await tx.alertRule.update({
            where: { id: rule.id },
            data: {
              armed: verdict.armed,
              ...(verdict.fires ? { lastFiredAt: new Date(now) } : {}),
            },
          });
        }
      }
      if (!fired.length) return null;

      const reasons = fired.map((kind) =>
        reasonFor(kind, {
          price: myPrice,
          previous: situation.before?.price ?? null,
          target: situation.target,
          currency,
          threshold: watch.rules.find((r) => r.kind === kind)?.threshold ?? null,
          rival: rival ?? null,
        }),
      );
      const alert = await tx.alert.create({
        data: {
          workspaceId: watch.workspaceId,
          watchId: watch.id,
          pricePointId: point.id,
          kinds: fired,
          price: myPrice === null ? null : BigInt(myPrice),
          previousPrice: situation.before?.price == null ? null : BigInt(situation.before.price),
          currency,
          reasons,
          verified: onThisPage && verified,
          firedAt: new Date(now),
        },
      });
      const pending: string[] = [];
      for (const channel of watch.workspace.channels) {
        const where =
          channel.status === 'broken'
            ? { status: 'skipped' as const, sendAfter: null, heldFor: 'the channel is broken' }
            : await placement(tx, channel.id, watch.workspace, now);
        const delivery = await tx.delivery.create({
          data: { alertId: alert.id, channelId: channel.id, ...where, createdAt: new Date(now) },
          select: { id: true, status: true },
        });
        if (delivery.status === 'pending') pending.push(delivery.id);
      }
      return { workspaceId: watch.workspaceId, pending };
    });
    if (!made) continue;
    alerts++;
    // After the commit: one send per delivery, however often it's asked for.
    for (const deliveryId of made.pending) {
      await deps.notify.add(
        'deliver',
        { deliveryId },
        {
          jobId: `deliver-${deliveryId}`,
          attempts: DELIVERY_ATTEMPTS,
          backoff: { type: 'custom' },
          removeOnComplete: { age: 86_400 },
          removeOnFail: { age: 7 * 86_400 },
        },
      );
    }
    await deps.publish({ type: 'alert', workspaceId: made.workspaceId }).catch(() => {});
  }
  return { alerts };
}

/** Everything a message about one alert needs. */
async function contentFor(db: Db, alertId: string, appUrl: string): Promise<AlertContent> {
  const alert = await db.alert.findUniqueOrThrow({
    where: { id: alertId },
    include: { watch: { include: { target: { include: { site: { select: { host: true } } } } } } },
  });
  const { watch } = alert;
  return {
    alertId: alert.id,
    label: watch.label ?? watch.target.title ?? watch.target.url,
    host: watch.target.site.host,
    url: watch.target.url,
    link: `${appUrl}/app/p/${watch.id}`,
    price: minor(alert.price),
    currency: alert.currency ?? 'GBP',
    kinds: alert.kinds,
    reasons: alert.reasons,
    verified: alert.verified,
    firedAt: alert.firedAt.toISOString(),
  };
}

/** A channel failed for good: count it, and after three in a row, mark it broken and tell its owner once. */
async function channelFailed(deps: SenderDeps, channelId: string, error: string) {
  const channel = await deps.db.channel.update({
    where: { id: channelId },
    data: { failures: { increment: 1 }, lastError: error },
    include: {
      workspace: {
        include: { memberships: { where: { role: 'owner' }, include: { user: true } } },
      },
    },
  });
  if (channel.failures < BREAK_AFTER || channel.status === 'broken') return;
  await deps.db.channel.update({ where: { id: channelId }, data: { status: 'broken' } });
  for (const { user } of channel.workspace.memberships) {
    await deps
      .mail({
        to: user.email,
        subject: `Your “${channel.name}” alerts have stopped working`,
        text: `Hello ${user.name},\n\nPennydrop couldn’t deliver to “${channel.name}” three times in a row. The last answer was:\n${error}\n\nAlerts to it are paused. Your other channels carry on. Fix the address, then press “Send a test” to switch it back on:\n${deps.appUrl}/app/channels\n`,
      })
      .catch(() => {});
  }
}

/**
 * Sends one delivery. It's sent at most once while it's pending; a failure
 * that's worth retrying is thrown, for the queue to try again later.
 */
export async function deliver(
  deps: SenderDeps,
  deliveryId: string,
): Promise<'sent' | 'skipped' | 'failed'> {
  const { db } = deps;
  const delivery = await db.delivery.findUnique({
    where: { id: deliveryId },
    include: { channel: true },
  });
  if (!delivery || delivery.status !== 'pending') return 'skipped';
  const settings = open<ChannelSettings>(delivery.channel.settings, deps.key);
  const message = compose(await contentFor(db, delivery.alertId, deps.appUrl));
  const result = await send(settings, message, delivery.id, deps.send);
  const attempts = delivery.attempts + 1;

  if (result.ok) {
    await db.$transaction([
      db.delivery.update({
        where: { id: delivery.id },
        data: {
          status: 'sent',
          attempts,
          sentAt: new Date(deps.now?.() ?? Date.now()),
          lastError: null,
        },
      }),
      db.channel.update({
        where: { id: delivery.channelId },
        data: { failures: 0, lastError: null, lastSentAt: new Date(deps.now?.() ?? Date.now()) },
      }),
    ]);
    return 'sent';
  }
  const final = result.permanent || attempts >= DELIVERY_ATTEMPTS;
  await db.delivery.update({
    where: { id: delivery.id },
    data: { status: final ? 'failed' : 'pending', attempts, lastError: result.error },
  });
  if (!final) throw new Error(result.error);
  await channelFailed(deps, delivery.channelId, result.error);
  return 'failed';
}

/**
 * Sends what was held back, one summary per channel: the night's alerts when
 * quiet hours end, the day's in the digest, a busy hour's at the next.
 */
export async function sendSummaries(deps: SenderDeps): Promise<number> {
  const { db } = deps;
  const now = new Date(deps.now?.() ?? Date.now());
  const due = await db.delivery.findMany({
    where: { status: 'batched', sendAfter: { lte: now } },
    include: { channel: true },
    orderBy: { createdAt: 'asc' },
    take: 1_000,
  });
  const byChannel = new Map<string, typeof due>();
  for (const delivery of due) {
    byChannel.set(delivery.channelId, [...(byChannel.get(delivery.channelId) ?? []), delivery]);
  }
  let sent = 0;
  for (const deliveries of byChannel.values()) {
    const channel = deliveries[0]!.channel;
    if (channel.status === 'broken') {
      await db.delivery.updateMany({
        where: { id: { in: deliveries.map((d) => d.id) } },
        data: { status: 'skipped', heldFor: 'the channel is broken' },
      });
      continue;
    }
    const contents = await Promise.all(
      deliveries.map((d) => contentFor(db, d.alertId, deps.appUrl)),
    );
    const message = composeSummary(contents, deliveries[0]!.heldFor ?? 'held back');
    const result = await send(
      open<ChannelSettings>(channel.settings, deps.key),
      message,
      `summary-${deliveries[0]!.id}`,
      deps.send,
    );
    const ids = deliveries.map((d) => d.id);
    if (result.ok) {
      await db.delivery.updateMany({
        where: { id: { in: ids } },
        data: { status: 'sent', sentAt: now },
      });
      await db.channel.update({
        where: { id: channel.id },
        data: { failures: 0, lastError: null, lastSentAt: now },
      });
      sent += ids.length;
      continue;
    }
    // Tried again at the next run, until it's had as many tries as a single delivery.
    const attempts = Math.max(...deliveries.map((d) => d.attempts)) + 1;
    const final = result.permanent || attempts >= DELIVERY_ATTEMPTS;
    await db.delivery.updateMany({
      where: { id: { in: ids } },
      data: { attempts, lastError: result.error, ...(final ? { status: 'failed' } : {}) },
    });
    if (final) await channelFailed(deps, channel.id, result.error);
  }
  return sent;
}
