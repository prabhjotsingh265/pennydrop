import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SiteGate } from './gate.ts';
import { redisConnection } from './redis.ts';

const redis = redisConnection();
let gate: SiteGate;
beforeEach(() => {
  // A fresh prefix per test: no two tests ever share a key.
  gate = new SiteGate(redis, (prefix = `test-${randomUUID()}`));
});
let prefix = '';
// Each test's keys go when it does.
afterEach(async () => {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
});
afterAll(() => redis.quit());

const rules = { gapMs: 1_000, maxInFlight: 1, leaseMs: 30_000 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the site gate', () => {
  it('lets the first request go and tells the next one how long to wait', async () => {
    expect(await gate.acquire('fickle', rules, 'a')).toBe(0);
    const wait = await gate.acquire('fickle', rules, 'b');
    expect(wait).toBeGreaterThan(900);
    expect(wait).toBeLessThanOrEqual(1_000);
  });

  it('keeps sites apart: one busy site never slows another', async () => {
    expect(await gate.acquire('slowpoke', rules, 'a')).toBe(0);
    expect(await gate.acquire('fickle', rules, 'b')).toBe(0);
  });

  it('holds back a second request while the first is still running', async () => {
    const quick = { gapMs: 0, maxInFlight: 1, leaseMs: 30_000 };
    expect(await gate.acquire('fickle', quick, 'a')).toBe(0);
    expect(await gate.acquire('fickle', quick, 'b')).toBeGreaterThan(0);
    await gate.release('fickle', 'a');
    expect(await gate.acquire('fickle', quick, 'b')).toBe(0);
  });

  it('takes back a slot whose worker never returned it', async () => {
    const short = { gapMs: 0, maxInFlight: 1, leaseMs: 150 };
    expect(await gate.acquire('fickle', short, 'crashed')).toBe(0);
    await sleep(200);
    expect(await gate.acquire('fickle', short, 'next')).toBe(0);
  });

  it('never lets two callers take the last slot, however many ask at once', async () => {
    const quick = { gapMs: 0, maxInFlight: 3, leaseMs: 30_000 };
    const waits = await Promise.all(
      Array.from({ length: 50 }, (_, i) => gate.acquire('fickle', quick, `t${i}`)),
    );
    expect(waits.filter((w) => w === 0)).toHaveLength(3);
  });

  it('honours a hold, such as a 429’s Retry-After', async () => {
    await gate.holdUntil('brittle', Date.now() + 30_000);
    const wait = await gate.acquire('brittle', rules, 'a');
    expect(wait).toBeGreaterThan(29_000);
  });
});
