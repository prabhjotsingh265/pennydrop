import { createDb } from '@pennydrop/db';
import { QUEUES, redisConnection, type FetchJob, type IngestJob } from '@pennydrop/queue';
import { Queue, Worker } from 'bullmq';
import { dispatch, type DispatchResult } from './dispatch.ts';
import { ingest } from './ingest.ts';

// The only process with the database: it decides what to check and records what was found.
const db = createDb();
const connection = redisConnection();
const queues = {
  http: new Queue<FetchJob>(QUEUES.fetchHttp, { connection }),
  browser: new Queue<FetchJob>(QUEUES.fetchBrowser, { connection }),
};
const ticks = new Queue(QUEUES.dispatch, { connection });

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

const ingester = new Worker<IngestJob>(QUEUES.ingest, (job) => ingest({ db, queues }, job.data), {
  connection,
  concurrency: 10,
});
ingester.on('failed', (job, error) => console.error(`ingest ${job?.id} failed:`, error.message));

console.log('Worker running: dispatching every 15 s, recording results.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await Promise.all([dispatcher.close(), ingester.close()]);
      await Promise.all([ticks.close(), queues.http.close(), queues.browser.close()]);
      await db.$disconnect();
      await connection.quit();
      process.exit(0);
    })();
  });
}
