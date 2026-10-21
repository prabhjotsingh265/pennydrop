import { hostname } from 'node:os';
import { Breaker, QUEUES, SiteGate, redisConnection, type IngestJob } from '@pennydrop/queue';
import { Queue, Worker } from 'bullmq';
import { BrowserPool } from './browser.ts';
import { createChecker } from './check.ts';
import { createPreviewProcessor } from './preview.ts';
import { createFetchProcessor } from './worker.ts';

// One codebase, two lanes: plain HTTP (many at once) or Chromium (a few at once).
const lane = process.env.FETCHER_LANE === 'browser' ? 'browser' : 'http';
const concurrency = Number(process.env.FETCHER_CONCURRENCY ?? (lane === 'browser' ? 2 : 20));
const userAgent =
  process.env.FETCHER_USER_AGENT ??
  'PennydropBot/0.1 (+https://pennydrop.ingenio-algomancer.com/bot)';

// Development only: the practice shops answer as *.localhost, from the "shop" container.
const localShop = process.env.LOCAL_SHOP_HOST;
const guard = localShop
  ? {
      allowPrivate: (host: string) => host.endsWith('.localhost'),
      resolveAs: (host: string) => (host.endsWith('.localhost') ? localShop : undefined),
    }
  : {};

const connection = redisConnection();
const pool = lane === 'browser' ? new BrowserPool(guard) : undefined;
const ingest = new Queue<IngestJob>(QUEUES.ingest, { connection });
const checker = createChecker({ userAgent, guard, pool });
const gate = new SiteGate(connection);
const breaker = new Breaker(connection);
const processor = createFetchProcessor({
  checker,
  gate,
  breaker,
  ingest,
  lane,
  worker: `${hostname()}/${lane}`,
});

const worker = new Worker(lane === 'browser' ? QUEUES.fetchBrowser : QUEUES.fetchHttp, processor, {
  connection,
  concurrency,
  // A browser check can take most of a minute; the lock must outlast it.
  lockDuration: lane === 'browser' ? 120_000 : 60_000,
});
worker.on('failed', (job, error) => console.error(`check ${job?.id} failed:`, error.message));
console.log(`Fetcher (${lane}) running ${concurrency} at a time.`);

// The browser lane also renders previews for people adding a product: one at a time, sharing its Chromium.
const previews =
  lane === 'browser'
    ? new Worker(
        QUEUES.preview,
        createPreviewProcessor({ checker, gate, breaker, redis: connection }),
        {
          connection,
          concurrency: 1,
          lockDuration: 120_000,
        },
      )
    : null;
previews?.on('failed', (job, error) => console.error(`preview ${job?.id} failed:`, error.message));

// Finish the checks in hand before exiting when Docker stops the container.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      await Promise.all([worker.close(), previews?.close()]);
      await pool?.close();
      await ingest.close();
      await connection.quit();
      process.exit(0);
    })();
  });
}
