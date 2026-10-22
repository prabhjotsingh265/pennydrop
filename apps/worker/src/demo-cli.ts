import { parseArgs } from 'node:util';
import { PRACTICE_INTERVAL_S, createDb, practiceTarget, syncTarget } from '@pennydrop/db';
import { LOCAL_PRACTICE_SHOP_URL, SANDBOX_PRODUCT, SHOWCASE, practiceUrl } from '@pennydrop/domain';
import { QUEUES, redisConnection, type FetchJob } from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { REPLAY_DAYS, startReplay } from './replay.ts';

// The demo's showcase: the products every demo watches, kept checked by a
// "Showcase" workspace nobody signs in to, with their history replayed. The
// mug is there too: each visitor's sandbox starts from its price. Run again,
// it adds only what's missing. Usage: demo [--days 60]
const { values } = parseArgs({
  options: { days: { type: 'string', default: String(REPLAY_DAYS) } },
});
const days = Number(values.days);
const template =
  process.env.PRACTICE_SHOP_URL ||
  (process.env.NODE_ENV === 'production' ? undefined : LOCAL_PRACTICE_SHOP_URL);
if (!template || !Number.isInteger(days) || days < 1 || days > 365) {
  console.error('Needs PRACTICE_SHOP_URL in production, and --days from 1 to 365.');
  process.exit(1);
}

const db = createDb();
const connection = redisConnection();
const http = new Queue<FetchJob>(QUEUES.fetchHttp, { connection });

const showcase =
  (await db.workspace.findFirst({ where: { name: 'Showcase', memberships: { none: {} } } })) ??
  (await db.workspace.create({ data: { name: 'Showcase', maxWatches: 50 } }));
const pages = [
  ...SHOWCASE.map((item) => practiceUrl(template, item.shop, `/p/${item.slug}`)),
  practiceUrl(template, 'fickle', `/p/${SANDBOX_PRODUCT}`),
];
let total = 0;
for (const url of pages) {
  const target = await practiceTarget(db, url);
  await db.watch.upsert({
    where: { workspaceId_targetId: { workspaceId: showcase.id, targetId: target.id } },
    update: {},
    create: { workspaceId: showcase.id, targetId: target.id, intervalSeconds: PRACTICE_INTERVAL_S },
  });
  await syncTarget(db, target.id);
  const readings = await startReplay({ db, http }, target.id, { days });
  console.log(
    `${url}: ${readings === null ? 'replaying already' : readings ? `${readings} readings to replay` : 'history already there'}`,
  );
  total += readings ?? 0;
}
console.log(
  `The showcase watches ${pages.length} products.` +
    (total
      ? ` ${total} readings are replaying in the background, about one a second per shop.`
      : ''),
);
await http.close();
await db.$disconnect();
await connection.quit();
