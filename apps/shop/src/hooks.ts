import express, { type Router } from 'express';

interface Caught {
  at: string;
  headers: Record<string, string>;
  body: unknown;
}

const KEEP = 50;
/** The headers worth seeing: who sent it, and how a receiver would check it. */
const SHOWN = ['content-type', 'user-agent', 'pennydrop-delivery', 'pennydrop-signature'];

/**
 * A stand-in for Slack, Discord and any webhook receiver, for development and
 * the demo: it keeps the last messages posted to each name. Add "?status=503"
 * to a channel's address and it fails, to show retries and broken channels.
 */
export function hooksRoutes(token: string | undefined): Router {
  const router = express.Router();
  const caught = new Map<string, Caught[]>();
  router.use(express.json({ limit: '256kb' }), express.text({ type: '*/*', limit: '256kb' }));

  router.use((req, res, next) => {
    if (!token || req.get('x-hooks-token') === token || req.query.token === token) return next();
    res.status(404).type('text').send('Not found');
  });

  router.post('/:name', (req, res) => {
    const list = caught.get(req.params.name) ?? [];
    const headers = Object.fromEntries(
      SHOWN.flatMap((h) => (req.get(h) ? [[h, req.get(h)!]] : [])),
    );
    list.unshift({ at: new Date().toISOString(), headers, body: req.body as unknown });
    caught.set(req.params.name, list.slice(0, KEEP));
    const status = Number(req.query.status ?? 200);
    res.status(status >= 200 && status < 600 ? status : 200).end();
  });

  router.get('/', (_req, res) => {
    res.json(Object.fromEntries([...caught].map(([name, list]) => [name, list.length])));
  });

  router.get('/:name', (req, res) => {
    res.json(caught.get(req.params.name) ?? []);
  });

  router.delete('/', (_req, res) => {
    caught.clear();
    res.status(204).end();
  });

  return router;
}
