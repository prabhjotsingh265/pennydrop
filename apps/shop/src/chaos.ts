import { timingSafeEqual } from 'node:crypto';
import express, { type Request, type Router } from 'express';
import { chaosPage } from './pages/other.ts';
import { shopFor, type SettingsStore } from './settings.ts';

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Turns the panel's form fields into settings: checkboxes, numbers and the wait range. */
function fromForm(body: Record<string, string>): Record<string, unknown> {
  return {
    layout: body.layout,
    stock: body.stock,
    sale: body.sale,
    jsonLd: body.jsonLd === 'true',
    microdata: body.microdata === 'true',
    metaTags: body.metaTags === 'true',
    errorRate: Number(body.errorRate),
    rateLimitRate: Number(body.rateLimitRate),
    blockRate: Number(body.blockRate),
    crawlDelay: Number(body.crawlDelay),
    latencyMs: [Number(body.latencyMin), Number(body.latencyMax)],
  };
}

/**
 * The controls that make a shop misbehave on purpose: an HTML panel for
 * people and a JSON endpoint for tests and the demo. With a token set (in
 * production) they answer 404 to anyone without it.
 */
export function chaosRoutes(store: SettingsStore, token: string | undefined): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }), express.json());

  router.use((req, res, next) => {
    if (!token) return next();
    const given = req.get('x-chaos-token') ?? req.query.token ?? req.body?.token;
    if (sameToken(given, token)) return next();
    res.status(404).type('text').send('Not found');
  });

  const shop = (req: Request) => shopFor(req.hostname);

  router.get('/', (req, res) => {
    res.type('html').send(chaosPage(shop(req), store.get(shop(req)), token));
  });

  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    if (body.reset === 'true') store.reset(shop(req));
    else store.update(shop(req), fromForm(body));
    res.redirect(303, token ? `/_chaos?token=${encodeURIComponent(token)}` : '/_chaos');
  });

  router.get('/state', (req, res) => {
    res.json(store.get(shop(req)));
  });

  router.put('/state', (req, res) => {
    res.json(store.update(shop(req), req.body));
  });

  router.post('/reset', (req, res) => {
    res.json(store.reset(shop(req)));
  });

  return router;
}
