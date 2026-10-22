import type { Db } from '@pennydrop/db';
import { updateWorkspaceSchema, type Me } from '@pennydrop/domain';
import type { LiveMessage } from '@pennydrop/queue';
import { fromNodeHeaders } from 'better-auth/node';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { systemLookup, type Lookup } from './addresses.ts';
import type { Auth } from './auth.ts';
import type { Config } from './config.ts';
import type { LiveHub } from './live.ts';
import { groupRoutes } from './groups.ts';
import { previewRoutes } from './preview-routes.ts';
import { reportRoutes } from './reports.ts';
import type { Previews } from './previews.ts';
import { watchRoutes } from './watches.ts';

export interface Member {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  role: 'owner' | 'member';
}

declare module 'fastify' {
  interface FastifyRequest {
    member: Member | null;
  }
}

export interface AppDeps {
  db: Db;
  auth: Auth;
  config: Config;
  /** Asks the dispatcher to run now, so a new or "check now" product isn't left for the next tick. */
  wake: () => Promise<void>;
  previews: Previews;
  /** Open dashboards on this process, and how to tell every process about a change. */
  live: LiveHub;
  publish: (message: LiveMessage) => Promise<void>;
  lookup?: Lookup;
  now?: () => number;
  logger?: boolean;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function buildApp(deps: AppDeps) {
  const { db, auth, config } = deps;
  const app = Fastify({ logger: deps.logger ?? process.env.NODE_ENV !== 'test' });
  const appOrigin = new URL(config.appUrl).origin;

  app.get('/api/health', async () => ({ status: 'ok' }));

  // Better Auth handles sign-up, sign-in, sessions and email confirmation.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, config.appUrl);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          body:
            request.method === 'POST' && request.body ? JSON.stringify(request.body) : undefined,
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  // Everything else under /api is for signed-in people, in their own workspace.
  app.decorateRequest('member', null);
  app.register(async (dashboard) => {
    dashboard.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      // Changes must come from the app itself: a form on another site can't use your session.
      if (!SAFE.has(request.method) && request.headers.origin !== appOrigin) {
        return reply.code(403).send({ error: 'Changes must come from Pennydrop itself.' });
      }
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session) return reply.code(401).send({ error: 'Please sign in.' });
      const membership = await db.membership.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'asc' },
      });
      if (!membership) return reply.code(403).send({ error: 'You don’t belong to a workspace.' });
      request.member = {
        userId: session.user.id,
        name: session.user.name,
        email: session.user.email,
        workspaceId: membership.workspaceId,
        role: membership.role,
      };
    });

    const me = async (member: Member): Promise<Me> => {
      const workspace = await db.workspace.findUniqueOrThrow({ where: { id: member.workspaceId } });
      return {
        user: { id: member.userId, name: member.name, email: member.email },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          timezone: workspace.timezone,
          role: member.role,
        },
      };
    };

    dashboard.get('/api/me', async (request) => me(request.member!));

    dashboard.patch('/api/workspace', async (request, reply) => {
      const member = request.member!;
      if (member.role !== 'owner') {
        return reply.code(403).send({ error: 'Only the workspace’s owner can change it.' });
      }
      const changes = updateWorkspaceSchema.parse(request.body ?? {});
      await db.workspace.update({ where: { id: member.workspaceId }, data: changes });
      return me(member);
    });

    const vet = { db, localShops: config.localShops, lookup: deps.lookup ?? systemLookup };
    await watchRoutes(dashboard, {
      ...vet,
      wake: deps.wake,
      previews: deps.previews,
      publish: deps.publish,
      now: deps.now,
    });
    await previewRoutes(dashboard, { ...vet, previews: deps.previews });
    await reportRoutes(dashboard, { db, screenshotDir: config.screenshotDir });
    await groupRoutes(dashboard, { db });

    // Live updates for the dashboard, as Server-Sent Events.
    dashboard.get('/api/events', async (request, reply) => {
      const { workspaceId } = request.member!;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Tells a buffering proxy (nginx) to pass each event on at once.
        'x-accel-buffering': 'no',
      });
      // If the connection drops, the browser tries again after 5 s.
      raw.write('retry: 5000\n\n');
      let closed = false;
      let disconnect = () => {};
      request.raw.on('close', () => {
        closed = true;
        disconnect();
      });
      disconnect = await deps.live.connect(workspaceId, {
        send: (event, data) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        ping: () => raw.write(': ping\n\n'),
        end: () => raw.end(),
      });
      if (closed) disconnect();
    });
  });

  // Before the server waits for open connections to finish: live streams never would.
  app.addHook('preClose', async () => deps.live.closeAll());

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(422).send({ error: 'Some of that wasn’t right.', issues: error.issues });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'Something went wrong on our side.' });
  });

  return app;
}
