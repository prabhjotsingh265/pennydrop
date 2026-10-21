import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pruneChecks } from './maintenance.ts';

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
