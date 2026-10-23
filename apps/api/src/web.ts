import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Where the build leaves the public pages it rendered ahead of time (apps/web/scripts/prerender.mjs). */
const PAGES = 'pages';

/** The public pages the build rendered, by address, with this server's own address written in. */
export function prerenderedPages(webDist: string, appUrl: string): Map<string, string> {
  const dir = join(webDist, PAGES);
  if (!existsSync(dir)) return new Map();
  const origin = appUrl.replace(/\/+$/, '');
  return new Map(
    readdirSync(dir)
      .filter((file) => file.endsWith('.html'))
      .map((file) => {
        const name = file.slice(0, -'.html'.length);
        const html = readFileSync(join(dir, file), 'utf8').replaceAll('__APP_URL__', origin);
        return [name === 'index' ? '/' : `/${name}`, html];
      }),
  );
}

/**
 * Production: the built app, from the API itself. Its hashed files never change, so they're
 * kept for a year. The public pages come rendered, for search engines and link previews;
 * every other address gets the app's empty page, kept out of search results.
 */
export function serveWeb(
  app: FastifyInstance,
  { webDist, appUrl, pagePolicy }: { webDist: string; appUrl: string; pagePolicy: string },
) {
  const pages = prerenderedPages(webDist, appUrl);
  app.register(fastifyStatic, {
    root: webDist,
    wildcard: false,
    index: false,
    // The rendered pages are only sent with this server's address in them.
    allowedPath: (path) => !path.startsWith(`/${PAGES}/`),
    // The build writes .br and .gz beside each text file: sent as the browser accepts.
    preCompressed: true,
    setHeaders: (reply, path) => {
      reply.header(
        'cache-control',
        path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });
  app.setNotFoundHandler((request, reply) => {
    // Any other address is one of the app's pages. A missing file (an old build's script
    // after a deploy) or API route is a plain 404, never the page in its place.
    const path = request.url.split('?')[0]!;
    const page =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !path.startsWith('/api/') &&
      !/\.[^/]*$/.test(path);
    if (!page) return reply.code(404).send({ error: 'Not found.' });
    reply.header('cache-control', 'no-cache');
    const rendered = pages.get(path.length > 1 ? path.replace(/\/+$/, '') : path);
    if (rendered) {
      return reply
        .type('text/html; charset=utf-8')
        .header('content-security-policy', pagePolicy)
        .send(rendered);
    }
    return reply.header('x-robots-tag', 'noindex').sendFile('index.html');
  });
}
