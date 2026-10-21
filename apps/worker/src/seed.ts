import { createDb } from '@pennydrop/db';
import { PRODUCTS } from '@pennydrop/shop/catalogue';

// Development only: the practice shops and their products, so the pipeline has work to do.
const db = createDb();
const listed = PRODUCTS.filter((product) => !product.clearance);
const shops = [
  {
    host: 'fickle.localhost',
    paths: listed.map((p) => `/p/${p.slug}`).concat('/clearance/taper-candles'),
  },
  { host: 'slowpoke.localhost', paths: listed.slice(0, 6).map((p) => `/p/${p.slug}`) },
  { host: 'brittle.localhost', paths: listed.slice(6, 12).map((p) => `/p/${p.slug}`) },
];

let added = 0;
for (const shop of shops) {
  const site = await db.site.upsert({
    where: { host: shop.host },
    update: {},
    // The practice shops can take a request a second; real shops get 10 s or their crawl delay.
    create: {
      host: shop.host,
      registrable: shop.host,
      demoAllowed: true,
      minGapMs: 1_000,
      maxInFlight: 2,
    },
  });
  for (const path of shop.paths) {
    const url = `http://${shop.host}:4000${path}`;
    const existing = await db.target.findUnique({ where: { canonicalUrl: url } });
    if (existing) continue;
    await db.target.create({
      data: { siteId: site.id, url, canonicalUrl: url, intervalSeconds: 900 },
    });
    added++;
  }
}
console.log(
  `Added ${added} products across ${shops.length} practice shops. The dispatcher picks them up within 15 s.`,
);
await db.$disconnect();
