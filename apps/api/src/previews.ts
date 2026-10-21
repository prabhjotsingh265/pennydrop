import { randomUUID } from 'node:crypto';
import {
  PREVIEW_KEEP_S,
  QUEUES,
  previewScreenshotKey,
  type PreviewJob,
  type PreviewResult,
  type Redis,
} from '@pennydrop/queue';
import { Job, Queue } from 'bullmq';

export type PreviewStatus = 'waiting' | 'working' | 'done' | 'failed';

export interface PreviewState {
  /** The address that was previewed, as cleaned. */
  url: string;
  status: PreviewStatus;
  /** What the fetcher is doing: "waiting" for the shop's turn, or "opening" the page. */
  step: string | null;
  result: PreviewResult | null;
}

/** Previews as the API sees them. Each is visible to the workspace that asked for it and no other. */
export interface Previews {
  start(job: PreviewJob): Promise<{ id: string } | { retryAfter: number }>;
  get(id: string, workspaceId: string): Promise<PreviewState | null>;
  screenshot(id: string, workspaceId: string): Promise<Buffer | null>;
}

/** Each preview opens a real browser on someone's shop: ten a minute per workspace is plenty. */
export const PREVIEWS_PER_MINUTE = 10;

/** Previews through BullMQ: the browser fetcher takes them, and its result stays on the job. */
export function queuePreviews(
  connection: Redis,
  prefix?: string,
): Previews & { close(): Promise<void> } {
  const queue = new Queue<PreviewJob, PreviewResult>(QUEUES.preview, {
    connection,
    ...(prefix ? { prefix } : {}),
  });
  const own = async (id: string, workspaceId: string) => {
    const job = await Job.fromId<PreviewJob, PreviewResult>(queue, id);
    return job?.data.workspaceId === workspaceId ? job : null;
  };

  return {
    async start(data) {
      const key = `pennydrop:preview-rate:${data.workspaceId}`;
      const count = await connection.incr(key);
      if (count === 1) await connection.expire(key, 60);
      if (count > PREVIEWS_PER_MINUTE) {
        return { retryAfter: Math.max(1, await connection.ttl(key)) };
      }
      const id = randomUUID();
      await queue.add('preview', data, {
        jobId: id,
        // Someone is waiting: a failed preview is shown, not retried.
        attempts: 1,
        removeOnComplete: { age: PREVIEW_KEEP_S },
        removeOnFail: { age: PREVIEW_KEEP_S },
      });
      return { id };
    },

    async get(id, workspaceId) {
      const job = await own(id, workspaceId);
      if (!job) return null;
      const state = await job.getState();
      if (state === 'unknown') return null;
      const status: PreviewStatus =
        state === 'completed'
          ? 'done'
          : state === 'failed'
            ? 'failed'
            : state === 'active'
              ? 'working'
              : 'waiting';
      const progress = job.progress as { step?: string } | number;
      return {
        url: job.data.url,
        status,
        step: typeof progress === 'object' ? (progress.step ?? null) : null,
        result: status === 'done' ? job.returnvalue : null,
      };
    },

    async screenshot(id, workspaceId) {
      if (!(await own(id, workspaceId))) return null;
      return connection.getBuffer(previewScreenshotKey(id));
    },

    close: () => queue.close(),
  };
}
