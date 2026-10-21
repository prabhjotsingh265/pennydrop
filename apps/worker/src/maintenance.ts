import type { Db } from '@pennydrop/db';

const DAY = 86_400_000;

/** How long the check log keeps each kind of check. Price history is kept for good. */
export const KEEP_DAYS = { succeeded: 30, failed: 90 };

/**
 * Deletes checks past their keep-by date, a batch at a time, so the table is
 * never locked for long while the pipeline is writing to it.
 */
export async function pruneChecks(db: Db, now = Date.now(), batch = 5_000): Promise<number> {
  const succeededBefore = new Date(now - KEEP_DAYS.succeeded * DAY);
  const failedBefore = new Date(now - KEEP_DAYS.failed * DAY);
  let total = 0;
  for (;;) {
    const removed = await db.$executeRaw`
      DELETE FROM checks WHERE id IN (
        SELECT id FROM checks
        WHERE (outcome IN ('ok', 'unchanged', 'suspicious') AND started_at < ${succeededBefore})
           OR started_at < ${failedBefore}
        LIMIT ${batch}
      )`;
    total += removed;
    if (removed < batch) return total;
  }
}
