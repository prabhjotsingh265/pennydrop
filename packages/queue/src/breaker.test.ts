import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Breaker } from './breaker.ts';
import { redisConnection } from './redis.ts';

const redis = redisConnection();
// Short cooldowns so the tests don't wait minutes: 200 ms, then 400 ms.
let breaker: Breaker;
beforeEach(() => {
  breaker = new Breaker(redis, (prefix = `test-${randomUUID()}`), [200, 400]);
});
let prefix = '';
// Each test's keys go when it does.
afterEach(async () => {
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length) await redis.del(...keys);
});
afterAll(() => redis.quit());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (times: number) =>
  Promise.all(Array.from({ length: times }, () => breaker.report('brittle', false)));

describe('the circuit breaker', () => {
  it('stays closed through a few failures', async () => {
    await fail(4);
    expect((await breaker.allow('brittle', 'a')).go).toBe(true);
  });

  it('opens after five failures in a row and turns checks away until the cooldown ends', async () => {
    const changes = await fail(5);
    expect(changes.filter((c) => c.change === 'opened')).toHaveLength(1);
    const decision = await breaker.allow('brittle', 'a');
    expect(decision.go).toBe(false);
  });

  it('opens when more than half of the last ten fail, even with successes between', async () => {
    for (const ok of [false, false, true, false, false, true, false, false, true, false]) {
      await breaker.report('brittle', ok);
    }
    expect((await breaker.state('brittle')).state).toBe('open');
  });

  it('lets exactly one probe through after the cooldown', async () => {
    await fail(5);
    await sleep(250);
    const first = await breaker.allow('brittle', 'probe');
    const second = await breaker.allow('brittle', 'other');
    expect(first).toEqual({ go: true, probe: true });
    expect(second.go).toBe(false);
  });

  it('closes when the probe succeeds', async () => {
    await fail(5);
    await sleep(250);
    await breaker.allow('brittle', 'probe');
    expect(await breaker.report('brittle', true)).toEqual({ change: 'closed' });
    expect((await breaker.allow('brittle', 'next')).go).toBe(true);
  });

  it('reopens for longer when the probe fails', async () => {
    await fail(5);
    await sleep(250);
    await breaker.allow('brittle', 'probe');
    const change = await breaker.report('brittle', false);
    expect(change).toMatchObject({ change: 'opened', trips: 2 });
    if (change.change === 'opened') expect(change.openUntil - Date.now()).toBeGreaterThan(300);
  });

  it('keeps sites apart', async () => {
    await fail(5);
    expect((await breaker.allow('fickle', 'a')).go).toBe(true);
  });
});
