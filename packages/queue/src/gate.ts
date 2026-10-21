import type { Redis } from 'ioredis';

// Atomic in Redis, so two workers can never both take the last slot.
// KEYS: the site's leases (a sorted set of token → expiry) and its state (a hash).
// ARGV: gap between requests, most in flight, lease length (all ms), the caller's token.
// Returns 0 when the slot is granted, otherwise how many ms to wait before asking again.
const ACQUIRE = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local gap = tonumber(ARGV[1])
local most = tonumber(ARGV[2])
local lease = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local nextAt = tonumber(redis.call('HGET', KEYS[2], 'next') or '0')
if nextAt > now then return nextAt - now end
if redis.call('ZCARD', KEYS[1]) >= most then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.max(math.min(tonumber(first[2]) - now, gap), 250)
end
redis.call('ZADD', KEYS[1], now + lease, ARGV[4])
redis.call('HSET', KEYS[2], 'next', now + gap)
redis.call('PEXPIRE', KEYS[1], lease + 60000)
redis.call('PEXPIRE', KEYS[2], gap + 86400000)
return 0
`;

// Pushes the site's next allowed request out to a moment: a 429's Retry-After.
const HOLD = `
local nextAt = tonumber(redis.call('HGET', KEYS[1], 'next') or '0')
if tonumber(ARGV[1]) > nextAt then redis.call('HSET', KEYS[1], 'next', ARGV[1]) end
redis.call('PEXPIRE', KEYS[1], 86400000)
return 1
`;

export interface GateRules {
  /** At least this long between two requests to the site. */
  gapMs: number;
  maxInFlight: number;
  /** A slot not given back within this is reclaimed: its worker has probably crashed. */
  leaseMs: number;
}

type GateRedis = Redis & {
  gateAcquire(
    leases: string,
    state: string,
    gap: number,
    most: number,
    lease: number,
    token: string,
  ): Promise<number>;
  gateHold(state: string, until: number): Promise<number>;
};

/**
 * Politeness per site, shared by every worker: a minimum gap between requests
 * and a limit on how many run at once. Callers that must wait are told how
 * long, so they can put the job back for exactly that long and take another
 * site's job meanwhile, instead of sleeping on a slot.
 */
export class SiteGate {
  readonly #redis: GateRedis;
  readonly #prefix: string;

  constructor(redis: Redis, prefix = 'pennydrop') {
    if (!('gateAcquire' in redis)) {
      redis.defineCommand('gateAcquire', { numberOfKeys: 2, lua: ACQUIRE });
      redis.defineCommand('gateHold', { numberOfKeys: 1, lua: HOLD });
    }
    this.#redis = redis as GateRedis;
    this.#prefix = prefix;
  }

  #keys(site: string) {
    return { leases: `${this.#prefix}:gate:${site}:leases`, state: `${this.#prefix}:gate:${site}` };
  }

  /** 0 if the caller may go now; otherwise milliseconds to wait. */
  acquire(site: string, rules: GateRules, token: string): Promise<number> {
    const { leases, state } = this.#keys(site);
    return this.#redis.gateAcquire(
      leases,
      state,
      rules.gapMs,
      rules.maxInFlight,
      rules.leaseMs,
      token,
    );
  }

  async release(site: string, token: string): Promise<void> {
    await this.#redis.zrem(this.#keys(site).leases, token);
  }

  /** No request to the site before this moment (ms since the epoch). */
  async holdUntil(site: string, until: number): Promise<void> {
    await this.#redis.gateHold(this.#keys(site).state, until);
  }
}
