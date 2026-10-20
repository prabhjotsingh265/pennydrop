import { buildApp } from './app.ts';

const app = buildApp();
const port = Number(process.env.API_PORT ?? 3001);

// Finish in-flight requests before exiting when Docker stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port });
