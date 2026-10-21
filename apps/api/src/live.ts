import type { Db } from '@pennydrop/db';
import type { LiveMessage } from '@pennydrop/queue';

/** One open dashboard: how to reach it, and which of its products are which pages. */
export interface LiveClient {
  send: (event: string, data: unknown) => void;
  /** A comment line: keeps proxies from closing a quiet connection. */
  ping: () => void;
  end: () => void;
}

interface Connection extends LiveClient {
  workspaceId: string;
  /** Product page id to this workspace's watch id. */
  targets: Map<string, string>;
}

/**
 * The open dashboards on this API process. Messages arrive from Redis (from
 * the worker, or any API process) and each goes only to the dashboards whose
 * workspace watches that page.
 */
export class LiveHub {
  readonly #db: Db;
  readonly #connections = new Set<Connection>();

  constructor(db: Db) {
    this.#db = db;
  }

  get size() {
    return this.#connections.size;
  }

  async #targets(workspaceId: string) {
    const watches = await this.#db.watch.findMany({
      where: { workspaceId },
      select: { id: true, targetId: true },
    });
    return new Map(watches.map((watch) => [watch.targetId, watch.id]));
  }

  /** Starts sending to a dashboard. Returns what to call when it goes away. */
  async connect(workspaceId: string, client: LiveClient): Promise<() => void> {
    // Counted as connected only once its pages are known, so nothing meant for it is missed.
    const connection: Connection = {
      ...client,
      workspaceId,
      targets: await this.#targets(workspaceId),
    };
    this.#connections.add(connection);
    return () => {
      this.#connections.delete(connection);
    };
  }

  async receive(message: LiveMessage): Promise<void> {
    if (message.type === 'checked') {
      for (const connection of this.#connections) {
        const watchId = connection.targets.get(message.targetId);
        if (watchId) {
          connection.send('checked', {
            watchId,
            outcome: message.outcome,
            priceChanged: message.priceChanged,
          });
        }
      }
      return;
    }
    // The watchlist changed: learn its pages again, then say so.
    const affected = [...this.#connections].filter((c) => c.workspaceId === message.workspaceId);
    if (!affected.length) return;
    const targets = await this.#targets(message.workspaceId);
    for (const connection of affected) {
      connection.targets = targets;
      connection.send('watches', {});
    }
  }

  ping() {
    for (const connection of this.#connections) connection.ping();
  }

  /** On shutdown: an open stream would otherwise hold the server open. */
  closeAll() {
    for (const connection of this.#connections) connection.end();
    this.#connections.clear();
  }
}
