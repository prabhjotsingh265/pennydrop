import { Redis } from 'ioredis';

/** A Redis connection. BullMQ's workers need commands to wait out a reconnect rather than fail. */
export function redisConnection(url = process.env.REDIS_URL): Redis {
  if (!url) throw new Error('REDIS_URL is not set.');
  return new Redis(url, { maxRetriesPerRequest: null });
}
