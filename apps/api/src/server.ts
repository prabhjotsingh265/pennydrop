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
import { LiveHub } from './live.ts';
import { createMailer } from './mail.ts';
import { queuePreviews } from './previews.ts';

const config = configFromEnv();
const db = createDb();
const auth = createAuth({ db, mail: createMailer(config), config });
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

const app = buildApp({ db, auth, config, wake, previews, live, publish });
const port = Number(process.env.API_PORT ?? 3001);

// Finish in-flight requests before exiting when Docker stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => {
        clearInterval(heartbeat);
        return Promise.all([ticks.close(), previews.close(), subscriber.quit(), db.$disconnect()]);
      })
      .then(() => connection.quit())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port });
