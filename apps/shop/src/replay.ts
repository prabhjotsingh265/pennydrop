import { createHmac, timingSafeEqual } from 'node:crypto';
import { OPENED } from './prices.ts';

/**
 * Replays: the page as it stood at a past moment, so the demo can show months
 * of honest history on day one. Only Pennydrop's replay job can ask, by
 * signing the moment with a secret the shop shares with it
 * (`@pennydrop/fetch`'s `replayHeaders`, which these must match).
 */
export const REPLAY_AT = 'pennydrop-replay-at';
export const REPLAY_SIGNATURE = 'pennydrop-replay-signature';
const DEV_REPLAY_SECRET = 'development-only-replay-secret';

export function replaySecretFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.REPLAY_SECRET || (env.NODE_ENV === 'production' ? undefined : DEV_REPLAY_SECRET);
}

export type ReplayAsk = null | { at: number } | { refused: string; status: 403 | 422 };

/**
 * What a request asks: nothing (an ordinary visit), a signed past moment, or
 * a replay to refuse. A refused one is never answered with today's page,
 * which would be recorded as a reading from the past.
 */
export function replayAsk(
  at: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
  now: number,
): ReplayAsk {
  if (at === undefined && signature === undefined) return null;
  if (!secret) return { refused: 'Replays aren’t open here.', status: 403 };
  const moment = Number(at);
  const expected = createHmac('sha256', secret).update(`replay:${at}`).digest();
  const given = Buffer.from(signature ?? '', 'hex');
  if (
    !Number.isInteger(moment) ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  ) {
    return { refused: 'That replay isn’t signed.', status: 403 };
  }
  if (moment < OPENED || moment > now) {
    return { refused: 'We weren’t trading then.', status: 422 };
  }
  return { at: moment };
}
