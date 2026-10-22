import type { Db, Prisma } from './index.ts';

type Client = Db | Prisma.TransactionClient;

/** Three failures make a page gone; a week of daily probes after that, and it's left alone. */
export const GONE_FOR_GOOD_STREAK = 10;

/**
 * A product page is checked as often as its keenest watcher asks, and stops
 * being checked when every watcher has paused it. Only "active" and "paused"
 * are changed here: a page that's gone or blocked stays that way.
 */
export async function syncTarget(db: Client, targetId: string): Promise<void> {
  const target = await db.target.findUnique({
    where: { id: targetId },
    select: { status: true, nextCheckAt: true },
  });
  if (!target) return;
  const watches = await db.watch.findMany({
    where: { targetId },
    select: { intervalSeconds: true, paused: true },
  });
  const active = watches.filter((watch) => !watch.paused);

  if (active.length === 0) {
    if (target.status === 'active')
      await db.target.update({ where: { id: targetId }, data: { status: 'paused' } });
    return;
  }
  const interval = Math.min(...active.map((watch) => watch.intervalSeconds));
  // Asked for more often: the next check comes no later than one new interval from now.
  const latest = new Date(Date.now() + interval * 1000);
  await db.target.update({
    where: { id: targetId },
    data: {
      intervalSeconds: interval,
      ...(target.status === 'paused'
        ? { status: 'active', nextCheckAt: new Date() }
        : target.nextCheckAt > latest
          ? { nextCheckAt: latest }
          : {}),
    },
  });
}

/** Practice shops are checked every 15 minutes, so a demo has something to watch. */
export const PRACTICE_INTERVAL_S = 900;

/**
 * A practice-shop page as a product to check: its site (made polite but quick,
 * a request a second) and its page, made if they're new. The address must
 * already be in its clean form, as `practiceUrl` writes it.
 */
export async function practiceTarget(db: Client, url: string) {
  const host = new URL(url).hostname;
  const site = await db.site.upsert({
    where: { host },
    update: {},
    create: { host, registrable: host, demoAllowed: true, minGapMs: 1_000, maxInFlight: 2 },
  });
  return db.target.upsert({
    where: { canonicalUrl: url },
    update: {},
    create: { siteId: site.id, url, canonicalUrl: url, intervalSeconds: PRACTICE_INTERVAL_S },
  });
}
