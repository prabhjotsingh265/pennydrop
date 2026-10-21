import type { Db } from '@pennydrop/db';
import { previewSchema, type PreviewView } from '@pennydrop/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Previews } from './previews.ts';
import { vetAddress, type VetDeps } from './sites.ts';

export interface PreviewRouteDeps extends VetDeps {
  db: Db;
  previews: Previews;
}

const idParams = z.object({ id: z.uuid() });

/** The live preview someone sees while adding a product: a screenshot with every price boxed. */
export async function previewRoutes(app: FastifyInstance, deps: PreviewRouteDeps) {
  const { db, previews } = deps;
  const notFound = (reply: FastifyReply) =>
    reply.code(404).send({ error: 'That preview has expired. Open the address again.' });

  app.post('/api/previews', async (request, reply) => {
    const { workspaceId } = request.member!;
    const { url } = previewSchema.parse(request.body ?? {});
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const vetted = await vetAddress(deps, workspace, url);
    if (!vetted.ok) return reply.code(422).send({ error: vetted.error, field: vetted.field });

    // Already on the watchlist: open it rather than preview it again.
    const existing = await db.watch.findFirst({
      where: { workspaceId, target: { canonicalUrl: vetted.url } },
      select: { id: true },
    });
    if (existing) return { watchId: existing.id };

    const { site } = vetted;
    const started = await previews.start({
      url: vetted.url,
      host: site.host,
      workspaceId,
      robots:
        site.robotsStatus && site.robotsFetchedAt
          ? {
              status: site.robotsStatus,
              body: site.robotsTxt ?? '',
              fetchedAt: site.robotsFetchedAt.getTime(),
            }
          : null,
      gapMs: Math.max(site.minGapMs, (site.crawlDelay ?? 0) * 1000),
      maxInFlight: site.maxInFlight,
    });
    if ('retryAfter' in started) {
      return reply
        .code(429)
        .header('retry-after', String(started.retryAfter))
        .send({
          error: `That’s a lot of previews at once. Try again in ${started.retryAfter} s.`,
          retryAfter: started.retryAfter,
        });
    }
    return reply.code(202).send({ id: started.id, url: vetted.url });
  });

  app.get('/api/previews/:id', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const state = await previews.get(params.data.id, request.member!.workspaceId);
    if (!state) return notFound(reply);
    // The selectors stay on the server: a save names a choice by its number, never a selector.
    const result = state.result && { ...state.result, selectors: undefined };
    return { status: state.status, step: state.step, result } satisfies PreviewView;
  });

  app.get('/api/previews/:id/screenshot', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return notFound(reply);
    const image = await previews.screenshot(params.data.id, request.member!.workspaceId);
    if (!image) return notFound(reply);
    return reply.type('image/jpeg').header('cache-control', 'private, max-age=1800').send(image);
  });
}
