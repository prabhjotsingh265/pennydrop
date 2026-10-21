import { createDb } from '@pennydrop/db';
import { buildApp } from './app.ts';
import { createAuth } from './auth.ts';
import { configFromEnv } from './config.ts';
import { createMailer } from './mail.ts';

const config = configFromEnv();
const db = createDb();
const auth = createAuth({ db, mail: createMailer(config), config });
const app = buildApp({ db, auth, config });
const port = Number(process.env.API_PORT ?? 3001);

// Finish in-flight requests before exiting when Docker stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port });
