import { createHmac } from 'node:crypto';

/**
 * Replays: our own practice shop can show a product page as it stood at a
 * past moment, for honest demo history. The moment is signed with a secret
 * the shop shares, so nobody else can ask; the shop checks it (apps/shop's
 * replay.ts) and refuses anything unsigned rather than answer with today.
 */
export const REPLAY_AT = 'pennydrop-replay-at';
export const REPLAY_SIGNATURE = 'pennydrop-replay-signature';
const DEV_REPLAY_SECRET = 'development-only-replay-secret';

/** In development a fixed secret; in production replays happen only if REPLAY_SECRET is set. */
export function replaySecretFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.REPLAY_SECRET || (env.NODE_ENV === 'production' ? undefined : DEV_REPLAY_SECRET);
}

/** The headers that ask for the page as it was at `at` (ms since the epoch). */
export function replayHeaders(at: number, secret: string): Record<string, string> {
  return {
    [REPLAY_AT]: String(at),
    [REPLAY_SIGNATURE]: createHmac('sha256', secret).update(`replay:${at}`).digest('hex'),
  };
}
