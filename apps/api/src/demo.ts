import { randomBytes } from 'node:crypto';
import { PRACTICE_INTERVAL_S, practiceTarget, syncTarget, type Db } from '@pennydrop/db';
import {
  DEMO_HOURS,
  SANDBOX_PRODUCT,
  SHOWCASE,
  breakSchema,
  demoTarget,
  practiceUrl,
  type BreakAction,
  type DemoState,
  type SandboxState,
} from '@pennydrop/domain';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance } from 'fastify';
import type { Auth } from './auth.ts';
import type { Config } from './config.ts';
import type { ShopControls, ShopSettings } from './shop-controls.ts';

const HOUR = 3_600_000;

/** What each "Break the shop" button changes on the visitor's own copy of the shop. */
const BREAKS: Record<Exclude<BreakAction, 'fix'>, Record<string, unknown>> = {
  redesign: { layout: 'redesign' },
  // Slow, but inside the fetcher's 10 seconds for the first byte.
  slow: { latencyMs: [6_000, 9_000] },
  fail: { errorRate: 1 },
  sell_out: { stock: 'out' },
  sale: { sale: 'on' },
};

export function sandboxState(settings: ShopSettings): SandboxState {
  return {
    redesigned: settings.layout !== 'classic',
    slow: settings.latencyMs[0] >= 4_000,
    failing: settings.errorRate > 0,
    soldOut: settings.stock === 'out',
    onSale: settings.sale === 'on',
  };
}

/**
 * A demo workspace for a new visitor: the showcase (shared pages, so their
 * history is already there), and one product on a private copy of the shop
 * with a target 10% under today's price, so a sale drops through it.
 */
export async function createDemo(
  db: Db,
  userId: string,
  template: string,
  now: number,
): Promise<{ workspaceId: string; sandboxTargetId: string }> {
  const workspace = await db.workspace.create({
    data: {
      name: 'Demo',
      isDemo: true,
      expiresAt: new Date(now + DEMO_HOURS * HOUR),
      maxWatches: 20,
      memberships: { create: { userId, role: 'owner' } },
    },
  });
  const groups = new Map<string, string>();
  for (const item of SHOWCASE) {
    const target = await practiceTarget(db, practiceUrl(template, item.shop, `/p/${item.slug}`));
    let groupId: string | null = null;
    if (item.group) {
      groupId = groups.get(item.group) ?? null;
      if (!groupId) {
        groupId = (
          await db.productGroup.create({ data: { workspaceId: workspace.id, name: item.group } })
        ).id;
        groups.set(item.group, groupId);
      }
    }
    const targetPrice =
      item.target && target.currentPrice !== null ? demoTarget(Number(target.currentPrice)) : null;
    await db.watch.create({
      data: {
        workspaceId: workspace.id,
        targetId: target.id,
        groupId,
        isMine: item.mine ?? false,
        intervalSeconds: PRACTICE_INTERVAL_S,
        targetPrice: targetPrice === null ? null : BigInt(targetPrice),
        rules: {
          create: [
            ...(targetPrice === null ? [] : [{ kind: 'below_target' as const }]),
            ...(item.mine ? [{ kind: 'undercut' as const }] : []),
          ],
        },
      },
    });
    await syncTarget(db, target.id);
  }

  // The visitor's own shop: the same product as Fickle's, so the same price today.
  const token = randomBytes(8).toString('hex');
  const twin = await db.target.findUnique({
    where: { canonicalUrl: practiceUrl(template, 'fickle', `/p/${SANDBOX_PRODUCT}`) },
    select: { currentPrice: true },
  });
  const sandbox = await practiceTarget(
    db,
    practiceUrl(template, `sandbox-${token}`, `/p/${SANDBOX_PRODUCT}`),
  );
  const targetPrice = twin?.currentPrice ? demoTarget(Number(twin.currentPrice)) : null;
  await db.watch.create({
    data: {
      workspaceId: workspace.id,
      targetId: sandbox.id,
      label: 'Stoneware mug, in your own shop',
      intervalSeconds: PRACTICE_INTERVAL_S,
      targetPrice: targetPrice === null ? null : BigInt(targetPrice),
      rules: {
        create: [
          ...(targetPrice === null ? [] : [{ kind: 'below_target' as const }]),
          { kind: 'back_in_stock' as const },
        ],
      },
    },
  });
  // Read it straight away.
  await db.target.update({ where: { id: sandbox.id }, data: { nextCheckAt: new Date(now) } });
  return { workspaceId: workspace.id, sandboxTargetId: sandbox.id };
}

/** The workspace's own copy of the shop: the product watched on a sandbox host. */
async function sandboxOf(db: Db, workspaceId: string) {
  return db.watch.findFirst({
    where: { workspaceId, target: { site: { host: { startsWith: 'sandbox-' } } } },
    include: { target: { select: { id: true, url: true } } },
  });
}

export interface DemoDeps {
  db: Db;
  auth: Auth;
  config: Config;
  shop: ShopControls | null;
  wake: () => Promise<void>;
  now: () => number;
}

/** Starting a demo: no session yet, so it sits beside the dashboard's routes, not behind them. */
export async function demoStartRoute(app: FastifyInstance, deps: DemoDeps) {
  const { db, auth, config } = deps;
  const appOrigin = new URL(config.appUrl).origin;

  app.post('/api/demo', async (request, reply) => {
    if (request.headers.origin !== appOrigin) {
      return reply.code(403).send({ error: 'Changes must come from Pennydrop itself.' });
    }
    if (!config.demo || !deps.shop) {
      return reply.code(503).send({ error: 'The demo isn’t open here.' });
    }
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers });
    if (session) {
      const membership = await db.membership.findFirst({
        where: { userId: session.user.id },
        include: { workspace: { select: { isDemo: true } } },
      });
      // Already in a demo: carry on in it.
      if (membership?.workspace.isDemo) return { workspaceId: membership.workspaceId };
      return reply.code(409).send({
        error: 'You’re signed in to your own account. Sign out first to try the demo.',
      });
    }
    const signed = await auth.api.signInAnonymous({ headers, returnHeaders: true });
    const { workspaceId } = await createDemo(
      db,
      signed.response.user.id,
      config.demo.practiceShopUrl,
      deps.now(),
    );
    await deps.wake();
    reply.header('set-cookie', signed.headers.getSetCookie());
    return reply.code(201).send({ workspaceId });
  });
}

/** The demo panel: how long is left, and the visitor's own shop to break. */
export async function demoRoutes(dashboard: FastifyInstance, deps: DemoDeps) {
  const { db } = deps;
  const notDemo = { error: 'This isn’t a demo workspace.' };

  dashboard.get('/api/demo', async (request, reply) => {
    const { workspaceId } = request.member!;
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (!workspace.isDemo || !workspace.expiresAt) return reply.code(404).send(notDemo);
    const sandbox = await sandboxOf(db, workspaceId);
    const state: DemoState = {
      expiresAt: workspace.expiresAt.toISOString(),
      sandbox:
        sandbox && deps.shop
          ? {
              watchId: sandbox.id,
              url: sandbox.target.url,
              state: sandboxState(await deps.shop.state(new URL(sandbox.target.url).host)),
            }
          : null,
    };
    return state;
  });

  dashboard.post('/api/demo/break', async (request, reply) => {
    const { workspaceId } = request.member!;
    const { action } = breakSchema.parse(request.body ?? {});
    const sandbox = await sandboxOf(db, workspaceId);
    if (!sandbox || !deps.shop) return reply.code(404).send(notDemo);
    const host = new URL(sandbox.target.url).host;
    const settings =
      action === 'fix' ? await deps.shop.reset(host) : await deps.shop.change(host, BREAKS[action]);
    // Checked straight away, so the timeline shows what the shop just did.
    await db.target.update({
      where: { id: sandbox.target.id },
      data: { nextCheckAt: new Date(deps.now()) },
    });
    await deps.wake();
    return { state: sandboxState(settings) };
  });
}
