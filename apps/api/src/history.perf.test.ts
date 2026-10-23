import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

// The performance budget (make perf): a year of one product's history loads in under 50 ms.
const DAY = 86_400_000;
const POINTS = 365 * 4;

const h = harness();
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

/** The middle and the 95th percentile of some timings. */
function spread(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
  };
}

it(`loads a year of one product's history (${POINTS} price changes) in under 50 ms`, async () => {
  await h.reset();
  const cookie = await h.signIn();
  const member = await h.db.membership.findFirstOrThrow({
    where: { user: { email: 'prabhjot@example.com' } },
  });
  const site = await h.db.site.create({
    data: { host: 'shop.example', registrable: 'shop.example' },
  });
  const target = await h.db.target.create({
    data: {
      siteId: site.id,
      url: 'https://shop.example/p/1',
      canonicalUrl: 'https://shop.example/p/1',
      currentPrice: 2599n,
      currency: 'GBP',
      inStock: true,
    },
  });
  const watch = await h.db.watch.create({
    data: { workspaceId: member.workspaceId, targetId: target.id, targetPrice: 1999n },
  });
  // A price that changed four times a day for a year, with a sale's "was" price now and then.
  const start = Date.now() - 365 * DAY;
  await h.db.pricePoint.createMany({
    data: Array.from({ length: POINTS }, (_, i) => ({
      targetId: target.id,
      firstSeenAt: new Date(start + i * (DAY / 4)),
      lastSeenAt: new Date(start + (i + 1) * (DAY / 4) - 1),
      price: BigInt(2000 + ((i * 37) % 900)),
      wasPrice: i % 50 === 0 ? 2999n : null,
      currency: 'GBP',
      inStock: i % 97 !== 0,
      firstCheckId: randomUUID(),
    })),
  });

  const load = () =>
    h.app.inject({
      method: 'GET',
      url: `/api/watches/${watch.id}`,
      headers: { cookie, origin: APP_URL },
    });
  for (let i = 0; i < 3; i++) await load(); // warmed up, as a running server is
  const times: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 50; i++) {
    const started = performance.now();
    const answer = await load();
    times.push(performance.now() - started);
    expect(answer.json().watch.history).toHaveLength(POINTS);
    bytes = answer.rawPayload.length;
  }
  const { median, p95 } = spread(times);
  console.log(
    `a year of history: median ${median.toFixed(1)} ms, 95th percentile ${p95.toFixed(1)} ms, ${Math.round(bytes / 1024)} KB of JSON`,
  );
  expect(p95).toBeLessThan(50);
});
