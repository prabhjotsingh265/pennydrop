import type { Db } from '@pennydrop/db';
import { updateWorkspaceSchema, type Me } from '@pennydrop/domain';
import type { Mailer } from '@pennydrop/alerts';
import type { LiveMessage } from '@pennydrop/queue';
import type { Queue } from 'bullmq';
import fastifyStatic from '@fastify/static';
import { fromNodeHeaders } from 'better-auth/node';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { systemLookup, type Lookup } from './addresses.ts';
import type { Auth } from './auth.ts';
import { adminRoutes, isAdmin } from './admin.ts';
import { alertRoutes } from './alerts.ts';
import { demoRoutes, demoStartRoute } from './demo.ts';
import type { Config } from './config.ts';
import type { LiveHub } from './live.ts';
import { groupRoutes } from './groups.ts';
import { limitHook, type Limiter } from './limits.ts';
import { previewRoutes } from './preview-routes.ts';
import type { ShopControls } from './shop-controls.ts';
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
  /** Sends email: confirmations, resets, and channel tests. */
  mail: Mailer;
  /** Open dashboards on this process, and how to tell every process about a change. */
  live: LiveHub;
  publish: (message: LiveMessage) => Promise<void>;
  /** Counts tries at sign-in, sign-up, "check now" and the like (`limits.ts`). */
  limiter: Limiter;
  /** The practice shop's chaos controls, for demo sandboxes. Without them, the demo is closed. */
  shop?: ShopControls | null;
  /** Every queue by name, for the System page to count. */
  queues?: Record<string, Queue>;
  /** Redis, for the health address to reach. */
  redis?: { ping: () => Promise<unknown> };
  lookup?: Lookup;
  now?: () => number;
  logger?: boolean;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Whether a store answered within two seconds. */
async function reachable(answer: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(resolve, 2_000, false);
  });
  try {
    return await Promise.race([answer.then(() => true), late]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a page from Pennydrop may load: only its own scripts, styles, fonts and
 * data, images from itself (and drawn ones), and never a frame around it.
 */
export function contentSecurityPolicy(https: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function buildApp(deps: AppDeps) {
  const { db, auth, config } = deps;
  const app = Fastify({
    logger: deps.logger ?? process.env.NODE_ENV !== 'test',
    trustProxy: config.trustProxy,
  });
  const appOrigin = new URL(config.appUrl).origin;

  // Every answer: no guessing its type, no framing it, no addresses leaked as referrers, only
  // this origin's scripts, styles and data (the app's pages included), and HTTPS kept once used.
  // Data from the API is never kept by a shared cache, unless a route says otherwise.
  const https = config.appUrl.startsWith('https://');
  const policy = contentSecurityPolicy(https);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header('content-security-policy', policy);
    if (https) reply.header('strict-transport-security', 'max-age=31536000');
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) {
      reply.header('cache-control', 'no-store');
    }
  });

  // Production: the built app, from the API itself. Its hashed files never change, so they're
  // kept for a year; index.html is asked for afresh, and answers for every page of the app.
  if (config.webDist) {
    app.register(fastifyStatic, {
      root: config.webDist,
      wildcard: false,
      index: false,
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
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }

  // For Docker and an uptime monitor: this process answers, and reaches its database and Redis.
  app.get('/api/health', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      reachable(db.$queryRaw`SELECT 1`),
      deps.redis ? reachable(deps.redis.ping()) : true,
    ]);
    if (database && redis) return { status: 'ok' };
    return reply.code(503).send({ status: 'down', database, redis });
  });

  // Signing in and up are counted per address, before anything else happens.
  app.addHook('onRequest', limitHook(deps.limiter, 'ip'));

  // Better Auth handles sign-up, sign-in, sessions and email confirmation.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, config.appUrl);
      // Demo visitors are signed in by /api/demo, which gives them their workspace; never directly.
      if (url.pathname === '/api/auth/sign-in/anonymous') {
        return reply.code(404).send({ error: 'Not found.' });
      }
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

  const demo = {
    db,
    auth,
    config,
    shop: deps.shop ?? null,
    wake: deps.wake,
    now: deps.now ?? Date.now,
  };
  app.register(async (open) => demoStartRoute(open, demo));

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
        include: { workspace: { select: { isDemo: true, expiresAt: true } } },
      });
      if (!membership) return reply.code(403).send({ error: 'You don’t belong to a workspace.' });
      // A demo ends when it expires, though the nightly clean-up deletes it later.
      const { isDemo, expiresAt } = membership.workspace;
      if (isDemo && expiresAt && expiresAt.getTime() <= (deps.now ?? Date.now)()) {
        return reply.code(401).send({ error: 'This demo has ended. Start another any time.' });
      }
      request.member = {
        userId: session.user.id,
        name: session.user.name,
        email: session.user.email,
        workspaceId: membership.workspaceId,
        role: membership.role,
      };
    });
    // Then the costly actions are counted per person.
    dashboard.addHook('preHandler', limitHook(deps.limiter, 'user'));

    const me = async (member: Member): Promise<Me> => {
      const workspace = await db.workspace.findUniqueOrThrow({ where: { id: member.workspaceId } });
      return {
        user: {
          id: member.userId,
          name: member.name,
          email: member.email,
          isAdmin: isAdmin(config, member.email),
        },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          timezone: workspace.timezone,
          role: member.role,
          quietFrom: workspace.quietFrom,
          quietUntil: workspace.quietUntil,
          digest: workspace.digest,
          digestAt: workspace.digestAt,
          isDemo: workspace.isDemo,
          expiresAt: workspace.expiresAt?.toISOString() ?? null,
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
    await alertRoutes(dashboard, { db, config, mail: deps.mail });
    await demoRoutes(dashboard, demo);
    await adminRoutes(dashboard, {
      db,
      config,
      queues: deps.queues ?? {},
      now: deps.now ?? Date.now,
    });

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
