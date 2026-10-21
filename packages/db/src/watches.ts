import type { Db, Prisma } from './index.ts';

type Client = Db | Prisma.TransactionClient;

/**
 * A product page is checked as often as its keenest watcher asks, and stops
 * being checked when every watcher has paused it. Only "active" and "paused"
 * are changed here: a page that's gone or blocked stays that way.
 */
export async function syncTarget(db: Client, targetId: string): Promise<void> {
  const target = await db.target.findUnique({ where: { id: targetId }, select: { status: true } });
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
  await db.target.update({
    where: { id: targetId },
    data: {
      intervalSeconds: Math.min(...active.map((watch) => watch.intervalSeconds)),
      ...(target.status === 'paused' ? { status: 'active', nextCheckAt: new Date() } : {}),
    },
  });
}
