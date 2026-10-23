import { createMailer } from '@pennydrop/alerts';
import { createDb } from '@pennydrop/db';
import {
  LIVE_CHANNEL,
  QUEUES,
  parseLive,
  publishLive,
  redisConnection,
  type LiveMessage,
} from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { buildApp } from './app.ts';
import { createAuth } from './auth.ts';
import { configFromEnv } from './config.ts';
import { redisLimiter } from './limits.ts';
import { shopControls } from './shop-controls.ts';
import { LiveHub } from './live.ts';
import { startWatchdog } from './watchdog.ts';

import { queuePreviews } from './previews.ts';

const config = configFromEnv();
const db = createDb();
const mail = createMailer(config.mail);
const auth = createAuth({ db, mail, config });
const connection = redisConnection();
const ticks = new Queue(QUEUES.dispatch, { connection });
// However many people press "check now" at once, at most one extra dispatch waits behind the running one.
const wake = async () => {
  await ticks.add(
    'now',
    {},
    {
      deduplication: { id: 'now', keepLastIfActive: true },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
};
const previews = queuePreviews(connection);

// Live updates: every API process hears every change, and passes on what its dashboards watch.
const live = new LiveHub(db);
const subscriber = connection.duplicate();
await subscriber.subscribe(LIVE_CHANNEL);
subscriber.on('message', (_channel, text) => {
  const message = parseLive(text);
  if (message)
    live.receive(message).catch((error: unknown) => console.error('live update failed:', error));
});
const heartbeat = setInterval(() => live.ping(), 25_000);
// A change not announced only costs other tabs a refresh: it never fails the request.
const publish = (message: LiveMessage) =>
  publishLive(connection, message).catch((error: unknown) =>
    console.error('live update not sent:', error),
  );

const limiter = redisLimiter(connection);
const shop = config.demo ? shopControls(config.demo.shopInternalUrl, config.demo.chaosToken) : null;

// Read-only handles on every queue, for the System page's counts.
const queues = Object.fromEntries(
  Object.values(QUEUES).map((name) => [name, new Queue(name, { connection })]),
);

const app = buildApp({
  db,
  auth,
  config,
  wake,
  previews,
  live,
  publish,
  mail,
  limiter,
  shop,
  queues,
  redis: connection,
});
const port = Number(process.env.API_PORT ?? 3001);

// The watchdog: emails the admins when checks stop reading pages, or the schedule or a queue
// falls behind. It lives here, not in the worker, so a dead worker can't silence it.
const stopWatchdog = startWatchdog({ db, redis: connection, queues, mail, config, now: Date.now });

// Finish in-flight requests before exiting when Docker stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => {
        clearInterval(heartbeat);
        stopWatchdog();
        return Promise.all([
          ticks.close(),
          previews.close(),
          ...Object.values(queues).map((queue) => queue.close()),
          subscriber.quit(),
          db.$disconnect(),
        ]);
      })
      .then(() => connection.quit())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port });
