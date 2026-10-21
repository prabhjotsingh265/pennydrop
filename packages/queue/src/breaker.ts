import type { Redis } from 'ioredis';

export type BreakerDecision = { go: true; probe: boolean } | { go: false; retryAt: number };
export type BreakerChange =
  { change: 'opened'; openUntil: number; trips: number } | { change: 'closed' } | { change: null };

/** Cooldowns after each opening in a row: 5 minutes, 15 minutes, an hour, six hours. */
export const COOLDOWNS_MS = [300_000, 900_000, 3_600_000, 21_600_000];

// May a check go ahead? Closed: yes. Open: no, until the cooldown ends; then one
// probe is let through (half open) while everyone else waits for its answer.
// Returns {1, probe} to go, or {0, retryAt}.
const ALLOW = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local state = redis.call('HGET', KEYS[1], 'state') or 'closed'
if state == 'closed' then return {1, 0} end
local untilAt = tonumber(redis.call('HGET', KEYS[1], 'until') or '0')
if state == 'open' and now < untilAt then return {0, untilAt} end
local probe = redis.call('HGET', KEYS[1], 'probe')
local probeUntil = tonumber(redis.call('HGET', KEYS[1], 'probe_until') or '0')
if probe and probe ~= ARGV[1] and probeUntil > now then return {0, probeUntil} end
redis.call('HSET', KEYS[1], 'state', 'half_open', 'probe', ARGV[1], 'probe_until', now + tonumber(ARGV[2]))
return {1, 1}
`;

// Records how a check went. Opens after five failures in a row, or more than
// half of the last ten; a failed probe reopens it for longer; any success closes it.
// ARGV: 1 for success or 0 for failure, then the cooldowns in ms.
// Returns {0} for no change, {1, until, trips} when it opened, {2} when it closed.
const REPORT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local ok = ARGV[1] == '1'
local state = redis.call('HGET', KEYS[1], 'state') or 'closed'
local recent = (redis.call('HGET', KEYS[1], 'recent') or '') .. (ok and 'S' or 'F')
if string.len(recent) > 10 then recent = string.sub(recent, -10) end
redis.call('HSET', KEYS[1], 'recent', recent)
redis.call('PEXPIRE', KEYS[1], 7 * 86400000)
if ok then
  redis.call('HSET', KEYS[1], 'streak', 0)
  if state ~= 'closed' then
    redis.call('HSET', KEYS[1], 'state', 'closed', 'trips', 0, 'recent', '')
    redis.call('HDEL', KEYS[1], 'probe', 'probe_until', 'until')
    return {2}
  end
  return {0}
end
local streak = redis.call('HINCRBY', KEYS[1], 'streak', 1)
local _, failures = string.gsub(recent, 'F', '')
if state == 'half_open' or streak >= 5 or (string.len(recent) == 10 and failures > 5) then
  if state == 'open' then return {0} end
  local trips = tonumber(redis.call('HGET', KEYS[1], 'trips') or '0')
  local cooldown = tonumber(ARGV[2 + math.min(trips, #ARGV - 2)])
  redis.call('HSET', KEYS[1], 'state', 'open', 'until', now + cooldown, 'trips', trips + 1, 'streak', 0, 'recent', '')
  redis.call('HDEL', KEYS[1], 'probe', 'probe_until')
  return {1, now + cooldown, trips + 1}
end
return {0}
`;

type BreakerRedis = Redis & {
  breakerAllow(key: string, token: string, probeMs: number): Promise<[number, number]>;
  breakerReport(key: string, ok: string, ...cooldowns: number[]): Promise<number[]>;
};

/**
 * A circuit breaker per site, shared by every worker. A site that keeps
 * failing is left alone for a while instead of tying up the queue, then tried
 * once; the probe's answer decides whether it's back.
 */
export class Breaker {
  readonly #redis: BreakerRedis;
  readonly #prefix: string;
  readonly #cooldowns: number[];

  constructor(redis: Redis, prefix = 'pennydrop', cooldowns = COOLDOWNS_MS) {
    if (!('breakerAllow' in redis)) {
      redis.defineCommand('breakerAllow', { numberOfKeys: 1, lua: ALLOW });
      redis.defineCommand('breakerReport', { numberOfKeys: 1, lua: REPORT });
    }
    this.#redis = redis as BreakerRedis;
    this.#prefix = prefix;
    this.#cooldowns = cooldowns;
  }

  #key(site: string) {
    return `${this.#prefix}:breaker:${site}`;
  }

  /** Whether a check may go ahead now; a probe's answer decides whether the site is back. */
  async allow(site: string, token: string, probeMs = 120_000): Promise<BreakerDecision> {
    const [go, value] = await this.#redis.breakerAllow(this.#key(site), token, probeMs);
    return go === 1 ? { go: true, probe: value === 1 } : { go: false, retryAt: value };
  }

  async report(site: string, ok: boolean): Promise<BreakerChange> {
    const [code, until, trips] = await this.#redis.breakerReport(
      this.#key(site),
      ok ? '1' : '0',
      ...this.#cooldowns,
    );
    if (code === 1) return { change: 'opened', openUntil: until!, trips: trips! };
    if (code === 2) return { change: 'closed' };
    return { change: null };
  }

  async state(
    site: string,
  ): Promise<{ state: 'closed' | 'open' | 'half_open'; openUntil: number | null }> {
    const [state, until] = await this.#redis.hmget(this.#key(site), 'state', 'until');
    return {
      state: (state as 'open' | 'half_open' | null) ?? 'closed',
      openUntil: until ? Number(until) : null,
    };
  }
}
