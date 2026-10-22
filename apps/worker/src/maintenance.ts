import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@pennydrop/db';
import { SCREENSHOT_KEEP_DAYS } from '@pennydrop/queue';

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

/**
 * Deletes screenshots of failed checks after a week, and forgets them on the
 * checks, which are kept longer. Returns how many files went.
 */
export async function pruneScreenshots(db: Db, dir: string, now = Date.now()): Promise<number> {
  const before = now - SCREENSHOT_KEEP_DAYS * DAY;
  await db.$executeRaw`
    UPDATE checks SET screenshot_key = NULL
    WHERE screenshot_key IS NOT NULL AND started_at < ${new Date(before)}`;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0; // No folder yet: nothing has been kept.
  }
  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.jpg')) continue;
    const path = join(dir, name);
    const { mtimeMs } = await stat(path);
    if (mtimeMs < before) {
      await rm(path, { force: true });
      removed++;
    }
  }
  return removed;
}
