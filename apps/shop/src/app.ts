import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { productArt } from './art.ts';
import { CATEGORIES, PRODUCTS, findProduct, type Product } from './catalogue.ts';
import { chaosRoutes } from './chaos.ts';
import { hooksRoutes } from './hooks.ts';
import {
  blockedPage,
  listingPage,
  notFoundPage,
  serverErrorPage,
  tooManyRequestsPage,
} from './pages/other.ts';
import { productPage, type Listed } from './pages/product.ts';
import { formatPence, quote } from './prices.ts';
import { REPLAY_AT, REPLAY_SIGNATURE, replayAsk } from './replay.ts';
import { DEFAULTS, SHOPS, SettingsStore, shopFor } from './settings.ts';

export interface ShopOptions {
  now?: () => number;
  random?: () => number;
  settings?: SettingsStore;
  /** When set, the chaos controls need it. Unset, they're open (local development). */
  chaosToken?: string;
  /** Shared with Pennydrop's replay job, which signs the past moments it asks for. Unset, replays are refused. */
  replaySecret?: string;
}

const RETRY_AFTER_SECONDS = 30;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fickle, Slowpoke and Brittle: one practice shop that answers as three, by
 * hostname. Built to change its prices and its pages, and to fail on purpose.
 */
export function buildShop(options: ShopOptions = {}) {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const store = options.settings ?? new SettingsStore();

  const app = express();
  app.disable('x-powered-by');

  // A replay sees the shop as it was: its usual layout and its prices then, with no chaos.
  const context = (req: Request, res: Response) => {
    const shop = shopFor(req.hostname);
    const replayAt = res.locals.replayAt as number | undefined;
    const settings = replayAt === undefined ? store.get(shop) : DEFAULTS[shop];
    const priced = (product: Product): Listed => ({
      product,
      quote: quote(product, replayAt ?? now(), settings),
    });
    return { shop, settings, priced };
  };

  app.use((req, res, next) => {
    const ask = replayAsk(
      req.get(REPLAY_AT),
      req.get(REPLAY_SIGNATURE),
      options.replaySecret,
      now(),
    );
    if (ask && 'refused' in ask) {
      res.status(ask.status).type('text').send(ask.refused);
      return;
    }
    if (ask) res.locals.replayAt = ask.at;
    next();
  });

  app.get('/robots.txt', (req, res) => {
    const { shop, settings } = context(req, res);
    res
      .type('text/plain')
      .send(
        [
          `# ${shop}: a practice shop for testing price monitors`,
          'User-agent: *',
          `Crawl-delay: ${settings.crawlDelay}`,
          'Disallow: /clearance/',
          'Disallow: /basket',
          'Disallow: /_chaos',
          'Disallow: /_hooks',
          '',
        ].join('\n'),
      );
  });

  app.get('/art/:file', (req, res, next) => {
    const { file } = req.params;
    const product = file.endsWith('.svg') ? findProduct(file.slice(0, -4)) : undefined;
    if (!product) return next();
    res
      .set('Cache-Control', 'public, max-age=86400')
      .type('image/svg+xml')
      .send(productArt(product));
  });

  app.use('/_chaos', chaosRoutes(store, options.chaosToken));
  app.use('/_hooks', hooksRoutes(options.chaosToken));

  // Every shop page from here on waits, and may fail, as the shop's settings say.
  app.use(async (req, res, next) => {
    // A replay is history, not a visit: it isn't slowed down or failed on purpose.
    if (res.locals.replayAt !== undefined) return next();
    const { settings } = context(req, res);
    const [shortest, longest] = settings.latencyMs;
    const wait = shortest + random() * (longest - shortest);
    if (wait > 0) await sleep(wait);

    const roll = random();
    const { errorRate, rateLimitRate, blockRate } = settings;
    if (roll < errorRate) {
      res.status(500).type('html').send(serverErrorPage());
    } else if (roll < errorRate + rateLimitRate) {
      res
        .status(429)
        .set('Retry-After', String(RETRY_AFTER_SECONDS))
        .type('html')
        .send(tooManyRequestsPage(RETRY_AFTER_SECONDS));
    } else if (roll < errorRate + rateLimitRate + blockRate) {
      res
        .status(403)
        .type('html')
        .send(blockedPage(randomBytes(6).toString('hex')));
    } else {
      res.set('Cache-Control', 'no-cache');
      next();
    }
  });

  app.get('/', (req, res) => {
    const { shop, settings, priced } = context(req, res);
    const items = PRODUCTS.filter((p) => !p.clearance).map(priced);
    res
      .type('html')
      .send(listingPage(shop, settings, `Welcome to ${shop}`, SHOPS[shop].tagline, items));
  });

  app.get('/c/:category', (req, res, next) => {
    const { category } = req.params;
    if (!Object.hasOwn(CATEGORIES, category)) return next();
    const { shop, settings, priced } = context(req, res);
    const items = PRODUCTS.filter((p) => p.category === category && !p.clearance).map(priced);
    const title = CATEGORIES[category as keyof typeof CATEGORIES];
    res
      .type('html')
      .send(listingPage(shop, settings, title, `${items.length} things we like.`, items));
  });

  // Clearance products live under /clearance/, which robots.txt asks crawlers to avoid.
  const productRoute =
    (clearance: boolean) => (req: Request, res: Response, next: NextFunction) => {
      const product = findProduct(String(req.params.slug));
      if (!product || product.clearance !== clearance) return next();
      const { shop, settings, priced } = context(req, res);
      const others = PRODUCTS.filter(
        (p) => p.category === product.category && p.slug !== product.slug && !p.clearance,
      )
        .slice(0, 3)
        .map(priced);
      res
        .type('html')
        .send(productPage({ shop, settings, product, quote: priced(product).quote, others }));
    };
  app.get('/p/:slug', productRoute(false));
  app.get('/clearance/:slug', productRoute(true));

  // What the modern layout's script asks for after the page loads.
  app.get('/api/price/:slug', (req, res, next) => {
    const product = findProduct(req.params.slug);
    if (!product) return next();
    const { quote: q } = context(req, res).priced(product);
    res.json({
      price: (q.price / 100).toFixed(2),
      currency: q.currency,
      display: formatPence(q.price),
      was: q.was === null ? null : (q.was / 100).toFixed(2),
      wasDisplay: q.was === null ? null : formatPence(q.was),
      inStock: q.inStock,
    });
  });

  app.use((req, res) => {
    const { shop, settings } = context(req, res);
    res.status(404).type('html').send(notFoundPage(shop, settings));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(422).json({ error: 'Those settings were refused.', issues: error.issues });
      return;
    }
    console.error(error);
    res.status(500).type('html').send(serverErrorPage());
  });

  return app;
}
