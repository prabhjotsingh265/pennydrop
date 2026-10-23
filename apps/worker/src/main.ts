import {
  channelKey,
  channelsKeyFromEnv,
  createMailer,
  mailSettingsFromEnv,
} from '@pennydrop/alerts';
import { createDb } from '@pennydrop/db';
import {
  QUEUES,
  createLog,
  publishLive,
  redisConnection,
  type FetchJob,
  type IngestJob,
} from '@pennydrop/queue';
import { Queue, Worker } from 'bullmq';
import {
  RETRY_DELAYS_MS,
  deliver,
  evaluate,
  sendSummaries,
  type NotifyJob,
  type SenderDeps,
} from './alerts.ts';
import { dispatch, type DispatchResult } from './dispatch.ts';
import { ingest } from './ingest.ts';
import { cleanDemos, pruneChecks, pruneScreenshots } from './maintenance.ts';
import { continueReplay } from './replay.ts';

const log = createLog('worker');

// Settings first, so a missing one stops the worker before it takes any work.
const mailSettings = mailSettingsFromEnv();
const channelsKey = channelKey(channelsKeyFromEnv());

// The only process with the database: it decides what to check and records what was found.
const db = createDb();
const connection = redisConnection();
const queues = {
  http: new Queue<FetchJob>(QUEUES.fetchHttp, { connection }),
  browser: new Queue<FetchJob>(QUEUES.fetchBrowser, { connection }),
};
const ticks = new Queue(QUEUES.dispatch, { connection });
const chores = new Queue(QUEUES.maintenance, { connection });
const judged = new Queue<{ pricePointId: string }>(QUEUES.alerts, { connection });
const notify = new Queue<NotifyJob>(QUEUES.notify, { connection });
const publish = (message: Parameters<typeof publishLive>[1]) =>
  publishLive(connection, message).catch((error: unknown) =>
    log.warn({ err: error }, 'live update not sent'),
  );

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
  // "held": the fetch queues are full, so nothing more is queued until they drain.
  if (result.dispatched || result.held) log.info(result, 'dispatched');
});
dispatcher.on('failed', (_job, error) => log.error({ err: error }, 'dispatch failed'));

// Nightly at 03:00 UTC: trim the check log. Price history is kept for good.
await chores.upsertJobScheduler(
  'prune-checks',
  { pattern: '0 3 * * *', tz: 'UTC' },
  { name: 'prune-checks' },
);
const screenshotDir = process.env.SCREENSHOT_DIR;
const maintainer = new Worker(
  QUEUES.maintenance,
  async () => ({
    pruned: await pruneChecks(db),
    screenshots: screenshotDir ? await pruneScreenshots(db, screenshotDir) : 0,
    demos: await cleanDemos(db),
  }),
  { connection, concurrency: 1 },
);
maintainer.on('completed', (_job, result) => log.info(result, 'tidied up'));
maintainer.on('failed', (_job, error) => log.error({ err: error }, 'tidying up failed'));

const ingester = new Worker<IngestJob>(
  QUEUES.ingest,
  async (job) => {
    const result = await ingest({ db, queues }, job.data);
    // History, replayed one moment at a time: no dashboard needs telling about each. The next
    // moment's job id is fixed, so carrying on after a repeat of this one queues nothing twice.
    if (job.data.job.reason === 'replay') {
      await continueReplay({ db, http: queues.http }, job.data.job);
      return result;
    }
    // Recorded and committed: open dashboards can show it now. A missed message only
    // costs a refresh, so it never fails the job.
    if (result.recorded) {
      await publishLive(connection, {
        type: 'checked',
        targetId: job.data.job.targetId,
        outcome: result.outcome,
        priceChanged: result.priceChanged,
      }).catch((error: unknown) => log.warn({ err: error }, 'live update not sent'));
    }
    // A new price: the alert rules look at it, once, however often this job runs.
    if (result.pricePointId) {
      await judged.add(
        'evaluate',
        { pricePointId: result.pricePointId },
        {
          jobId: `evaluate-${result.pricePointId}`,
          removeOnComplete: { age: 86_400 },
          removeOnFail: { age: 7 * 86_400 },
        },
      );
    }
    return result;
  },
  { connection, concurrency: 10 },
);
// The job id is the fetch job's: the same on the fetcher's line for this check.
ingester.on('completed', (job, result) => {
  if (!result.recorded) return;
  log.info(
    {
      job: job.id,
      check: result.checkId,
      target: job.data.job.targetId,
      outcome: result.outcome,
      priceChanged: result.priceChanged,
      ...(result.events.length && { events: result.events }),
    },
    'recorded',
  );
});
ingester.on('failed', (job, error) => log.error({ job: job?.id, err: error }, 'recording failed'));

// Alerts: the rules judge each new price, and each delivery is sent and retried on its own.
const localShop = process.env.LOCAL_SHOP_HOST;
const mail = createMailer(mailSettings);
const sender: SenderDeps = {
  db,
  key: channelsKey,
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  mail,
  publish,
  send: {
    mail,
    userAgent: 'Pennydrop/1.0 (+alerts)',
    // Development: the practice shop's catcher answers for *.localhost. Elsewhere, public addresses only.
    guard: localShop
      ? {
          allowPrivate: (host) => host.endsWith('.localhost'),
          resolveAs: (host) => (host.endsWith('.localhost') ? localShop : undefined),
        }
      : {},
  },
};
const judge = new Worker<{ pricePointId: string }>(
  QUEUES.alerts,
  (job) => evaluate({ db, notify, publish }, job.data.pricePointId),
  { connection, concurrency: 5 },
);
judge.on('completed', (job, result) => {
  if (result.alerts) log.info({ pricePoint: job.data.pricePointId, ...result }, 'alerted');
});
judge.on('failed', (job, error) =>
  log.error({ pricePoint: job?.data.pricePointId, err: error }, 'alert rules failed'),
);

await notify.upsertJobScheduler('summaries', { every: 60_000 }, { name: 'summaries' });
const notifier = new Worker<NotifyJob>(
  QUEUES.notify,
  (job) =>
    job.name === 'summaries' ? sendSummaries(sender) : deliver(sender, job.data.deliveryId),
  {
    connection,
    concurrency: 10,
    // About 1, 3, 8, 15 and 30 minutes between tries: an hour, all told.
    settings: {
      backoffStrategy: (attemptsMade: number) =>
        RETRY_DELAYS_MS[Math.min(attemptsMade, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0]!,
    },
  },
);
notifier.on('completed', (job, result) => {
  if (job.name === 'summaries') {
    if (result) log.info({ summaries: result }, 'summaries sent');
  } else log.info({ delivery: job.data.deliveryId, result }, 'delivery');
});
notifier.on('failed', (job, error) =>
  log.error(
    { delivery: job?.data.deliveryId, attempt: job?.attemptsMade, err: error },
    'delivery failed',
  ),
);

log.info('running: dispatching every 15 s, recording results');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await Promise.all([
        dispatcher.close(),
        ingester.close(),
        maintainer.close(),
        judge.close(),
        notifier.close(),
      ]);
      await Promise.all([
        ticks.close(),
        chores.close(),
        queues.http.close(),
        queues.browser.close(),
        judged.close(),
        notify.close(),
      ]);
      await db.$disconnect();
      await connection.quit();
      process.exit(0);
    })();
  });
}
