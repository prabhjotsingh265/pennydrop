import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * The CHANNELS_KEY secret, which the API (sealing) and the worker (opening)
 * must share. In development a fixed one is used; in production it must be set.
 */
export function channelsKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.CHANNELS_KEY || (env.NODE_ENV === 'production' ? undefined : DEV_CHANNELS_KEY);
  if (!key) throw new Error('CHANNELS_KEY must be set in production.');
  return key;
}
const DEV_CHANNELS_KEY = 'development-only-channels-key-not-for-production';

/** A 256-bit key for channel settings, derived from the CHANNELS_KEY secret. */
export function channelKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'pennydrop', 'channel settings', 32));
}

/**
 * Seals a channel's settings (a webhook address, a signing secret) with
 * AES-256-GCM: a fresh 12-byte nonce each time, and the tag that refuses any
 * change to the stored text. Stored as "v1." + base64url(nonce, tag, ciphertext).
 */
export function seal(value: unknown, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64url')}`;
}

export function open<T>(sealed: string, key: Buffer): T {
  if (!sealed.startsWith('v1.')) throw new Error('Not sealed by this version.');
  const raw = Buffer.from(sealed.slice(3), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
    'utf8',
  );
  return JSON.parse(text) as T;
}

/** A webhook's signing secret: shown to its owner, never sent with a message. */
export const newSigningSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/**
 * The Pennydrop-Signature header: when it was sent, and an HMAC-SHA256 of
 * "timestamp.body" keyed with the channel's secret.
 */
export function sign(body: string, secret: string, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

/**
 * How a receiver checks a message: the signature matches, compared in
 * constant time, and it's no older than the tolerance, so a captured
 * message can't be replayed later.
 */
export function verify(
  header: string,
  body: string,
  secret: string,
  now: number,
  toleranceS = 300,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=', 2) as [string, string]),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(now / 1000 - timestamp) > toleranceS) return false;
  const expected = Buffer.from(sign(body, secret, timestamp).split('v1=')[1]!, 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
