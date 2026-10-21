import { randomUUID } from 'node:crypto';
import type { PreviewJob, PreviewResult } from '@pennydrop/queue';
import type { PreviewState, Previews } from '../src/previews.ts';

/** Previews kept in memory, finished by the test rather than a browser. */
export class FakePreviews implements Previews {
  readonly started: (PreviewJob & { id: string })[] = [];
  readonly #states = new Map<string, PreviewState & { workspaceId: string }>();
  readonly #images = new Map<string, Buffer>();
  limited = false;

  async start(job: PreviewJob) {
    if (this.limited) return { retryAfter: 42 };
    const id = randomUUID();
    this.started.push({ ...job, id });
    this.#states.set(id, {
      url: job.url,
      workspaceId: job.workspaceId,
      status: 'waiting',
      step: null,
      result: null,
    });
    return { id };
  }

  /** What the browser fetcher would have sent back. */
  finish(id: string, result: PreviewResult, image = Buffer.from('jpeg')) {
    const state = this.#states.get(id)!;
    this.#states.set(id, { ...state, status: 'done', result });
    this.#images.set(id, image);
  }

  async get(id: string, workspaceId: string) {
    const state = this.#states.get(id);
    if (!state || state.workspaceId !== workspaceId) return null;
    const { url, status, step, result } = state;
    return { url, status, step, result };
  }

  async screenshot(id: string, workspaceId: string) {
    return (await this.get(id, workspaceId)) ? (this.#images.get(id) ?? null) : null;
  }

  clear() {
    this.started.length = 0;
    this.#states.clear();
    this.#images.clear();
    this.limited = false;
  }
}
