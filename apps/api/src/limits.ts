import type { Redis } from '@pennydrop/queue';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** How many times something may happen in a window of time. */
export interface Rule {
  max: number;
  windowMs: number;
}

export interface Limiter {
  /** Counts one more; `allowed` is false once the window's count is past the rule's max. */
  hit(key: string, rule: Rule): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Who may try what, and how often. Signing in and up are counted per IP
 * address, before anyone is known; everything else per signed-in person.
 * Keys are a method and a route as Fastify names it.
 */
export const LIMITS = {
  /** Guessing passwords. */
  'POST /api/auth/sign-in/email': { by: 'ip', max: 10, windowMs: 10 * MINUTE },
  'POST /api/auth/delete-user': { by: 'ip', max: 10, windowMs: 10 * MINUTE },
  /** Each of these sends an email. */
  'POST /api/auth/sign-up/email': { by: 'ip', max: 5, windowMs: HOUR },
  'POST /api/auth/request-password-reset': { by: 'ip', max: 5, windowMs: HOUR },
  'POST /api/auth/send-verification-email': { by: 'ip', max: 5, windowMs: HOUR },
  /** Each of these makes us fetch a page, or render one in a browser. */
  'POST /api/watches/:id/check': { by: 'user', max: 30, windowMs: 10 * MINUTE },
  'POST /api/previews': { by: 'user', max: 30, windowMs: 10 * MINUTE },
  'POST /api/watches/bulk': { by: 'user', max: 10, windowMs: HOUR },
  /** A test message can go to any address someone types. */
  'POST /api/channels/:id/test': { by: 'user', max: 10, windowMs: 10 * MINUTE },
} as const satisfies Record<string, Rule & { by: 'ip' | 'user' }>;

// One window per key: the first hit starts it, and it ends on its own.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

type LimitRedis = Redis & { limitHit(key: string, windowMs: number): Promise<[number, number]> };

/** Counts in Redis, so every API process shares them and a restart doesn't reset them. */
export function redisLimiter(redis: Redis, prefix = 'pennydrop:limit'): Limiter {
  if (!('limitHit' in redis)) redis.defineCommand('limitHit', { numberOfKeys: 1, lua: HIT });
  const r = redis as LimitRedis;
  return {
    async hit(key, rule) {
      const [count, ttl] = await r.limitHit(`${prefix}:${key}`, rule.windowMs);
      return { allowed: count <= rule.max, retryAfterMs: Math.max(ttl, 0) };
    },
  };
}

/** For tests that aren't about limits. */
export const unlimited: Limiter = { hit: async () => ({ allowed: true, retryAfterMs: 0 }) };

/** "a minute", "12 minutes": how long to wait, in words. */
export function waitWords(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

/**
 * A hook that counts the request against its route's rule, if it has one, and
 * answers 429 past it. `by: 'user'` rules need the signed-in member, so that
 * hook runs after the session check.
 */
export function limitHook(limiter: Limiter, by: 'ip' | 'user') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Better Auth answers every /api/auth/* path from one route, so those go by their own path.
    const route =
      request.routeOptions.url === '/api/auth/*'
        ? request.url.split('?')[0]
        : request.routeOptions.url;
    const name = `${request.method} ${route}`;
    const rule = (LIMITS as Record<string, Rule & { by: 'ip' | 'user' }>)[name];
    if (!rule || rule.by !== by) return;
    const subject = by === 'user' ? request.member?.userId : request.ip;
    if (!subject) return;
    // "POST:/api/watches/:id/check:<user>": no spaces, so the keys are easy to find in Redis.
    const key = `${name.replace(' ', ':')}:${subject}`;
    const { allowed, retryAfterMs } = await limiter.hit(key, rule);
    if (allowed) return;
    const seconds = Math.ceil(retryAfterMs / 1000);
    const error = `That’s a lot of tries. Please wait ${waitWords(retryAfterMs)} and try again.`;
    // `message` too: the sign-in forms read Better Auth's errors from there.
    return reply
      .code(429)
      .header('retry-after', String(seconds))
      .send({ error, message: error, retryAfter: seconds });
  };
}
