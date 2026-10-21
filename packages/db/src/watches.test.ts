import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDb } from './testing.ts';
import { syncTarget } from './watches.ts';

const db = testDb('db');
beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

async function setup() {
  const site = await db.site.create({
    data: { host: 'fickle.example.com', registrable: 'example.com' },
  });
  const target = await db.target.create({
    data: { siteId: site.id, url: 'u', canonicalUrl: 'u', intervalSeconds: 21600 },
  });
  const [a, b] = await Promise.all(
    ['A', 'B'].map((name) => db.workspace.create({ data: { name } })),
  );
  return { target, a: a!, b: b! };
}

describe('syncTarget', () => {
  it('checks a page as often as its keenest watcher asks', async () => {
    const { target, a, b } = await setup();
    await db.watch.create({
      data: { workspaceId: a.id, targetId: target.id, intervalSeconds: 3600 },
    });
    await db.watch.create({
      data: { workspaceId: b.id, targetId: target.id, intervalSeconds: 43200 },
    });
    await syncTarget(db, target.id);
    expect((await db.target.findUniqueOrThrow({ where: { id: target.id } })).intervalSeconds).toBe(
      3600,
    );
  });

  it('pauses a page nobody is watching, and wakes it when someone does', async () => {
    const { target, a } = await setup();
    const watch = await db.watch.create({
      data: { workspaceId: a.id, targetId: target.id, paused: true },
    });
    await syncTarget(db, target.id);
    expect((await db.target.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('paused');

    await db.watch.update({ where: { id: watch.id }, data: { paused: false } });
    await syncTarget(db, target.id);
    expect((await db.target.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('active');
  });

  it('leaves a page that’s gone as gone', async () => {
    const { target, a } = await setup();
    await db.target.update({ where: { id: target.id }, data: { status: 'gone' } });
    await db.watch.create({ data: { workspaceId: a.id, targetId: target.id } });
    await syncTarget(db, target.id);
    expect((await db.target.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('gone');
  });
});
