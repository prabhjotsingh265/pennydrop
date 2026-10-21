import type { Redis } from './redis.ts';

/** Where the worker and the API tell open dashboards that something changed. */
export const LIVE_CHANNEL = 'pennydrop:live';

export type LiveMessage =
  /** A check of a product page was recorded. */
  | { type: 'checked'; targetId: string; outcome: string; priceChanged: boolean }
  /** A workspace's watchlist changed: added, edited or removed. */
  | { type: 'watches'; workspaceId: string };

export async function publishLive(redis: Redis, message: LiveMessage): Promise<void> {
  await redis.publish(LIVE_CHANNEL, JSON.stringify(message));
}

/** A message off the channel, or null for anything that isn't one of ours. */
export function parseLive(text: string): LiveMessage | null {
  try {
    const message = JSON.parse(text) as Partial<LiveMessage> | null;
    if (message?.type === 'checked' && typeof message.targetId === 'string') {
      return message as LiveMessage;
    }
    if (message?.type === 'watches' && typeof message.workspaceId === 'string') {
      return message as LiveMessage;
    }
    return null;
  } catch {
    return null;
  }
}
