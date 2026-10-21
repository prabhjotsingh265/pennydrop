import { createDb } from '@pennydrop/db';
import {
  QUEUES,
  publishLive,
  redisConnection,
  type FetchJob,
  type IngestJob,
} from '@pennydrop/queue';
import { Queue, Worker } from 'bullmq';
import { dispatch, type DispatchResult } from './dispatch.ts';
import { ingest } from './ingest.ts';
import { pruneChecks } from './maintenance.ts';

// The only process with the database: it decides what to check and records what was found.
const db = createDb();
const connection = redisConnection();
const queues = {
  http: new Queue<FetchJob>(QUEUES.fetchHttp, { connection }),
  browser: new Queue<FetchJob>(QUEUES.fetchBrowser, { connection }),
};
const ticks = new Queue(QUEUES.dispatch, { connection });
const chores = new Queue(QUEUES.maintenance, { connection });

// A job scheduler runs the tick once every 15 s, however many of these processes run.
await ticks.upsertJobScheduler(
  'dispatch',
  { every: 15_000 },
  { name: 'tick', opts: { removeOnComplete: 100, removeOnFail: 100 } },
);

const dispatcher = new Worker<unknown, DispatchResult>(
  QUEUES.dispatch,
  () => dispatch(db, queues),
  {
    connection,
    concurrency: 1,
  },
);
dispatcher.on('completed', (_job, result) => {
  if (result.dispatched || result.held) {
    console.log(
      `dispatch: ${result.dispatched} queued${result.held ? ' (held: queues full)' : ''}`,
    );
  }
});
dispatcher.on('failed', (_job, error) => console.error('dispatch failed:', error.message));

// Nightly at 03:00 UTC: trim the check log. Price history is kept for good.
await chores.upsertJobScheduler(
  'prune-checks',
  { pattern: '0 3 * * *', tz: 'UTC' },
  { name: 'prune-checks' },
);
const maintainer = new Worker(QUEUES.maintenance, async () => ({ pruned: await pruneChecks(db) }), {
  connection,
  concurrency: 1,
});
maintainer.on('completed', (_job, result) =>
  console.log(`maintenance: pruned ${result.pruned} old checks`),
);

const ingester = new Worker<IngestJob>(
  QUEUES.ingest,
  async (job) => {
    const result = await ingest({ db, queues }, job.data);
    // Recorded and committed: open dashboards can show it now. A missed message only
    // costs a refresh, so it never fails the job.
    if (result.recorded) {
      await publishLive(connection, {
        type: 'checked',
        targetId: job.data.job.targetId,
        outcome: result.outcome,
        priceChanged: result.priceChanged,
      }).catch((error: unknown) => console.error('live update not sent:', error));
    }
    return result;
  },
  { connection, concurrency: 10 },
);
ingester.on('failed', (job, error) => console.error(`ingest ${job?.id} failed:`, error.message));

console.log('Worker running: dispatching every 15 s, recording results.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await Promise.all([dispatcher.close(), ingester.close(), maintainer.close()]);
      await Promise.all([
        ticks.close(),
        chores.close(),
        queues.http.close(),
        queues.browser.close(),
      ]);
      await db.$disconnect();
      await connection.quit();
      process.exit(0);
    })();
  });
}
