import { buildShop } from './app.ts';

const port = Number(process.env.SHOP_PORT ?? 4000);
const app = buildShop({ chaosToken: process.env.SHOP_CHAOS_TOKEN || undefined });

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Practice shops: http://fickle.localhost:${port} · slowpoke · brittle`);
});

// Finish in-flight requests before exiting when Docker stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
