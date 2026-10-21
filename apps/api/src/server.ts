import { createDb } from '@pennydrop/db';
import { QUEUES, redisConnection } from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { buildApp } from './app.ts';
import { createAuth } from './auth.ts';
import { configFromEnv } from './config.ts';
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
const app = buildApp({ db, auth, config, wake, previews });
const port = Number(process.env.API_PORT ?? 3001);

// Finish in-flight requests before exiting when Docker stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => Promise.all([ticks.close(), previews.close(), db.$disconnect()]))
      .then(() => connection.quit())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port });
