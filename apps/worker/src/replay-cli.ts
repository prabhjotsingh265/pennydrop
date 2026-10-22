import { parseArgs } from 'node:util';
import { createDb } from '@pennydrop/db';
import { QUEUES, redisConnection, type FetchJob } from '@pennydrop/queue';
import { Queue } from 'bullmq';
import { REPLAY_DAYS, startReplay } from './replay.ts';

// Replays the history of every practice-shop product someone watches, in the
// background: the workers fetch each past moment behind the live checks.
// Run again, it carries on from where it got to. Usage: replay [--days 60]
const { values } = parseArgs({
  options: { days: { type: 'string', default: String(REPLAY_DAYS) } },
});
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 365) {
  console.error('--days takes a whole number from 1 to 365.');
  process.exit(1);
}

const db = createDb();
const connection = redisConnection();
const http = new Queue<FetchJob>(QUEUES.fetchHttp, { connection });
const targets = await db.target.findMany({
  where: { site: { demoAllowed: true }, watches: { some: {} } },
  select: { id: true, url: true },
  orderBy: { url: 'asc' },
});
let total = 0;
for (const target of targets) {
  const readings = await startReplay({ db, http }, target.id, { days });
  if (readings) console.log(`${target.url}: ${readings} readings to replay`);
  total += readings;
}
console.log(
  total
    ? `${total} readings queued. Each shop takes about one a second, behind the live checks.`
    : 'Nothing to replay: every watched product already has its history.',
);
await http.close();
await db.$disconnect();
await connection.quit();
