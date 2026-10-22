import { randomUUID } from 'node:crypto';
import { redisConnection } from '@pennydrop/queue';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';
import { LIMITS, redisLimiter, waitWords } from './limits.ts';

const redis = redisConnection();
// Each run counts under its own prefix, so runs never share a window.
const h = harness({ limiter: redisLimiter(redis, `test-limit-${randomUUID()}`) });

beforeEach(async () => {
  h.sent.length = 0;
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
  await redis.quit();
});

describe('redisLimiter', () => {
  it('allows the rule’s number of tries in a window, then says how long to wait', async () => {
    const limiter = redisLimiter(redis, `test-limit-${randomUUID()}`);
    const rule = { max: 3, windowMs: 60_000 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit('k', rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterMs).toBeGreaterThan(55_000);
    // Another key has its own count.
    expect((await limiter.hit('other', rule)).allowed).toBe(true);
  });

  it('starts again when the window ends', async () => {
    const limiter = redisLimiter(redis, `test-limit-${randomUUID()}`);
    const rule = { max: 1, windowMs: 150 };
    expect((await limiter.hit('k', rule)).allowed).toBe(true);
    expect((await limiter.hit('k', rule)).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await limiter.hit('k', rule)).allowed).toBe(true);
  });

  it('says how long in words', () => {
    expect(waitWords(1_000)).toBe('a minute');
    expect(waitWords(9 * 60_000 + 1)).toBe('10 minutes');
  });
});

describe('the API’s limits', () => {
  const signIn = (password: string, remoteAddress = '198.51.100.7') =>
    h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: APP_URL },
      remoteAddress,
      payload: { email: 'p@example.com', password },
    });

  it('stops guessing passwords from one address, and only that address', async () => {
    const { max } = LIMITS['POST /api/auth/sign-in/email'];
    for (let i = 0; i < max; i++) expect((await signIn(`guess ${i}`)).statusCode).toBe(401);
    const refused = await signIn('one more');
    expect(refused.statusCode).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(500);
    // The sign-in form shows Better Auth's `message`.
    expect(refused.json().message).toBe(
      'That’s a lot of tries. Please wait 10 minutes and try again.',
    );
    expect((await signIn('guess', '198.51.100.8')).statusCode).toBe(401);
  });

  it('counts test messages per person, so one person’s spree doesn’t stop another’s', async () => {
    const mine = await h.signIn('a@example.com');
    const theirs = await h.signIn('b@example.com');
    const test = async (cookie: string) => {
      const { channels } = (
        await h.app.inject({ method: 'GET', url: '/api/channels', headers: { cookie } })
      ).json();
      return h.app.inject({
        method: 'POST',
        url: `/api/channels/${channels[0].id}/test`,
        headers: { cookie, origin: APP_URL },
      });
    };
    const { max } = LIMITS['POST /api/channels/:id/test'];
    for (let i = 0; i < max; i++) expect((await test(mine)).statusCode).toBe(200);
    expect((await test(mine)).statusCode).toBe(429);
    expect(
      h.sent.filter((m) => m.to === 'a@example.com' && m.subject.includes('test')),
    ).toHaveLength(max);
    expect((await test(theirs)).statusCode).toBe(200);
  });

  it('limits "check now" across all of someone’s products', async () => {
    const cookie = await h.signIn();
    const headers = { cookie, origin: APP_URL };
    const { watch } = (
      await h.app.inject({
        method: 'POST',
        url: '/api/watches',
        headers,
        payload: { url: 'https://fickle.example.com/p/mug' },
      })
    ).json();
    const check = () =>
      h.app.inject({ method: 'POST', url: `/api/watches/${watch.id}/check`, headers });
    const { max } = LIMITS['POST /api/watches/:id/check'];
    // Nothing runs the checks here, so the per-product minute never starts: only the limit stops it.
    for (let i = 0; i < max; i++) expect((await check()).statusCode).toBe(202);
    const refused = await check();
    expect(refused.statusCode).toBe(429);
    expect(refused.json().retryAfter).toBeGreaterThan(500);
  });
});
