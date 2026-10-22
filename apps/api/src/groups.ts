import type { Db } from '@pennydrop/db';
import { groupSchema, type GroupDetail, type GroupSummary } from '@pennydrop/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { include, summarise } from './watches.ts';

const idParams = z.object({ id: z.uuid() });
const DAY_MS = 86_400_000;
/** Compare shows the last 90 days. */
const COMPARE_DAYS = 90;

/** Product groups: the same item at several shops. Each lives in one workspace. */
export async function groupRoutes(app: FastifyInstance, { db }: { db: Db }) {
  async function find(workspaceId: string, params: unknown) {
    const parsed = idParams.safeParse(params);
    if (!parsed.success) return null;
    return db.productGroup.findFirst({ where: { id: parsed.data.id, workspaceId } });
  }
  const notFound = (reply: FastifyReply) =>
    reply.code(404).send({ error: 'We couldn’t find that group.' });

  app.get('/api/groups', async (request): Promise<{ groups: GroupSummary[] }> => {
    const groups = await db.productGroup.findMany({
      where: { workspaceId: request.member!.workspaceId },
      include: { _count: { select: { watches: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        products: group._count.watches,
      })),
    };
  });

  app.post('/api/groups', async (request, reply) => {
    const { name } = groupSchema.parse(request.body ?? {});
    const group = await db.productGroup.create({
      data: { workspaceId: request.member!.workspaceId, name },
    });
    return reply.code(201).send({ group: { id: group.id, name: group.name, products: 0 } });
  });

  app.get('/api/groups/:id', async (request, reply) => {
    const group = await find(request.member!.workspaceId, request.params);
    if (!group) return notFound(reply);
    const rows = await db.watch.findMany({
      where: { groupId: group.id },
      include,
      orderBy: { createdAt: 'asc' },
    });
    const since = new Date(Date.now() - COMPARE_DAYS * DAY_MS);
    return {
      group: { id: group.id, name: group.name },
      watches: await summarise(db, rows, since),
    } satisfies GroupDetail;
  });

  app.patch('/api/groups/:id', async (request, reply) => {
    const group = await find(request.member!.workspaceId, request.params);
    if (!group) return notFound(reply);
    const { name } = groupSchema.parse(request.body ?? {});
    await db.productGroup.update({ where: { id: group.id }, data: { name } });
    return { group: { id: group.id, name } };
  });

  // The products stay on the watchlist; they just stop being compared.
  app.delete('/api/groups/:id', async (request, reply) => {
    const group = await find(request.member!.workspaceId, request.params);
    if (!group) return notFound(reply);
    await db.productGroup.delete({ where: { id: group.id } });
    return reply.code(204).send();
  });
}
