import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanDemos, pruneChecks, pruneScreenshots } from './maintenance.ts';

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

describe('cleanDemos', () => {
  it('deletes ended demos, their visitors and their own shops, and pauses what only they watched', async () => {
    const shared = await db.site.create({
      data: { host: 'fickle.localhost', registrable: 'fickle.localhost' },
    });
    const kettle = await db.target.create({
      data: { siteId: shared.id, url: 'k', canonicalUrl: 'k' },
    });
    const vase = await db.target.create({
      data: { siteId: shared.id, url: 'v', canonicalUrl: 'v' },
    });
    const demo = async (token: string, endsInHours: number) => {
      const visitor = await db.user.create({
        data: {
          id: `visitor-${token}`,
          name: 'Demo visitor',
          email: `temp-${token}@anonymous.placeholder.invalid`,
          isAnonymous: true,
          createdAt: new Date(NOW - 30 * 3_600_000),
        },
      });
      const sandbox = await db.site.create({
        data: { host: `sandbox-${token}.localhost`, registrable: `sandbox-${token}.localhost` },
      });
      const mug = await db.target.create({
        data: { siteId: sandbox.id, url: `m-${token}`, canonicalUrl: `m-${token}` },
      });
      return db.workspace.create({
        data: {
          name: 'Demo',
          isDemo: true,
          expiresAt: new Date(NOW + endsInHours * 3_600_000),
          memberships: { create: { userId: visitor.id } },
          watches: { create: [{ targetId: kettle.id }, { targetId: mug.id }] },
        },
      });
    };
    await demo('ended0001', -1);
    await demo('running01', 5);
    // The showcase keeps the vase watched; only the ended demo and the running one watch the kettle.
    await db.workspace.create({
      data: { name: 'Showcase', watches: { create: { targetId: vase.id } } },
    });

    expect(await cleanDemos(db, NOW)).toEqual({ demos: 1, visitors: 1, sandboxes: 1 });
    expect((await db.site.findMany({ orderBy: { host: 'asc' } })).map((s) => s.host)).toEqual([
      'fickle.localhost',
      'sandbox-running01.localhost',
    ]);
    expect(await db.user.findMany({ select: { id: true } })).toEqual([{ id: 'visitor-running01' }]);
    // Still watched by the running demo.
    expect((await db.target.findUniqueOrThrow({ where: { id: kettle.id } })).status).toBe('active');

    // A day later the other ends too; then nothing watches the kettle, and it's paused.
    expect(await cleanDemos(db, NOW + 6 * 3_600_000)).toEqual({
      demos: 1,
      visitors: 1,
      sandboxes: 1,
    });
    expect((await db.target.findUniqueOrThrow({ where: { id: kettle.id } })).status).toBe('paused');
    expect((await db.target.findUniqueOrThrow({ where: { id: vase.id } })).status).toBe('active');
  });

  it('leaves a visitor signed in this past hour, who may be getting their demo now', async () => {
    await db.user.create({
      data: {
        id: 'new',
        name: 'Demo visitor',
        email: 'temp-new@anonymous.placeholder.invalid',
        isAnonymous: true,
        createdAt: new Date(NOW - 10 * 60_000),
      },
    });
    expect((await cleanDemos(db, NOW)).visitors).toBe(0);
  });
});
