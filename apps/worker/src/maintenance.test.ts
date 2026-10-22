import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pruneChecks, pruneScreenshots } from './maintenance.ts';

const db = testDb('worker');
const NOW = Date.UTC(2026, 9, 21);
const DAY = 86_400_000;

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe('pruneChecks', () => {
  it('keeps successful checks for 30 days, failed ones for 90, in batches', async () => {
    const { id: siteId } = await db.site.create({
      data: { host: 'fickle.example.com', registrable: 'example.com' },
    });
    const { id: targetId } = await db.target.create({
      data: { siteId, url: 'u', canonicalUrl: 'u' },
    });
    const ages = [
      ['ok', 10],
      ['ok', 31],
      ['unchanged', 45],
      ['timeout', 31],
      ['timeout', 89],
      ['http_error', 91],
    ] as const;
    await db.check.createMany({
      data: ages.map(([outcome, days], i) => {
        const at = new Date(NOW - days * DAY);
        return {
          targetId,
          jobId: `j${i}`,
          reason: 'scheduled',
          scheduledFor: at,
          startedAt: at,
          finishedAt: at,
          outcome,
        };
      }),
    });

    expect(await pruneChecks(db, NOW, 1)).toBe(3);
    const left = await db.check.findMany({ orderBy: { startedAt: 'desc' } });
    expect(
      left.map((c) => `${c.outcome} ${Math.round((NOW - c.startedAt.getTime()) / DAY)}`),
    ).toEqual(['ok 10', 'timeout 31', 'timeout 89']);
  });
});

describe('pruneScreenshots', () => {
  it('deletes screenshots after a week, and forgets them on the checks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pennydrop-prune-'));
    const { id: siteId } = await db.site.create({
      data: { host: 'fickle.example.com', registrable: 'example.com' },
    });
    const { id: targetId } = await db.target.create({
      data: { siteId, url: 'u', canonicalUrl: 'u' },
    });
    for (const [key, days] of [
      ['old', 8],
      ['new', 2],
    ] as const) {
      const at = new Date(NOW - days * DAY);
      await db.check.create({
        data: {
          targetId,
          jobId: key,
          reason: 'scheduled',
          scheduledFor: at,
          startedAt: at,
          finishedAt: at,
          outcome: 'blocked',
          screenshotKey: key,
        },
      });
      const file = join(dir, `${key}.jpg`);
      await writeFile(file, 'jpeg');
      await utimes(file, at, at);
    }

    expect(await pruneScreenshots(db, dir, NOW)).toBe(1);
    expect(await readdir(dir)).toEqual(['new.jpg']);
    const keys = (await db.check.findMany({ orderBy: { jobId: 'asc' } })).map((c) => [
      c.jobId,
      c.screenshotKey,
    ]);
    expect(keys).toEqual([
      ['new', 'new'],
      ['old', null],
    ]);
    await rm(dir, { recursive: true, force: true });
  });

  it('copes with no folder yet', async () => {
    expect(await pruneScreenshots(db, join(tmpdir(), 'pennydrop-none-here'), NOW)).toBe(0);
  });
});
