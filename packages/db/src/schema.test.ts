import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertTestDatabase, resetDatabase, testDatabaseUrl, testDb } from './testing.ts';

const db = testDb('db');
beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const site = () =>
  db.site.create({ data: { host: 'fickle.example.com', registrable: 'example.com' } });

describe('the test database guard', () => {
  it('names each suite’s database after it, ending in _test', () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@postgres:5432/pennydrop';
    expect(new URL(testDatabaseUrl('worker')).pathname).toBe('/pennydrop_worker_test');
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/pennydrop_test';
    expect(new URL(testDatabaseUrl('worker')).pathname).toBe('/pennydrop_worker_test');
    process.env.DATABASE_URL = before;
  });

  it('refuses a database that isn’t a test database', () => {
    expect(() => assertTestDatabase('postgresql://u:p@postgres:5432/pennydrop')).toThrow(
      /Refusing/,
    );
  });
});

describe('the schema', () => {
  it('keeps one product page per address', async () => {
    const { id: siteId } = await site();
    const data = {
      siteId,
      url: 'https://fickle.example.com/p/mug',
      canonicalUrl: 'https://fickle.example.com/p/mug',
    };
    await db.target.create({ data });
    await expect(db.target.create({ data })).rejects.toThrow();
  });

  it('refuses prices that aren’t positive and currencies that aren’t codes', async () => {
    const { id: siteId } = await site();
    const base = { siteId, url: 'https://a.example.com/x' };
    await expect(
      db.target.create({ data: { ...base, canonicalUrl: 'a', currentPrice: 0n } }),
    ).rejects.toThrow();
    await expect(
      db.target.create({ data: { ...base, canonicalUrl: 'b', currency: 'pounds' } }),
    ).rejects.toThrow();
    await expect(
      db.target.create({ data: { ...base, canonicalUrl: 'c', intervalSeconds: 5 } }),
    ).rejects.toThrow();
  });

  it('stores money as exact whole minor units', async () => {
    const { id: siteId } = await site();
    const huge = 12_345_678_901_234n;
    const target = await db.target.create({
      data: {
        siteId,
        url: 'https://a.example.com/car',
        canonicalUrl: 'car',
        currentPrice: huge,
        currency: 'IDR',
      },
    });
    expect(target.currentPrice).toBe(huge);
  });

  it('removes a site’s products, checks and history with the site', async () => {
    const { id: siteId } = await site();
    const target = await db.target.create({ data: { siteId, url: 'u', canonicalUrl: 'u' } });
    const now = new Date();
    const check = await db.check.create({
      data: {
        targetId: target.id,
        jobId: 'j1',
        reason: 'scheduled',
        scheduledFor: now,
        startedAt: now,
        finishedAt: now,
        outcome: 'ok',
      },
    });
    await db.pricePoint.create({
      data: {
        targetId: target.id,
        firstSeenAt: now,
        lastSeenAt: now,
        price: 3199n,
        currency: 'GBP',
        inStock: true,
        firstCheckId: check.id,
      },
    });
    await db.site.delete({ where: { id: siteId } });
    expect(await db.check.count()).toBe(0);
    expect(await db.pricePoint.count()).toBe(0);
  });
});
