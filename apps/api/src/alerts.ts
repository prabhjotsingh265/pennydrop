import {
  channelKey,
  compose,
  hintFor,
  open,
  seal,
  send,
  settingsFor,
  type ChannelSettings,
  type Mailer,
} from '@pennydrop/alerts';
import type { Db } from '@pennydrop/db';
import {
  RULE_KINDS,
  channelSchema,
  ruleSchema,
  type AlertSummary,
  type ChannelSummary,
  type RuleSummary,
} from '@pennydrop/domain';
import type { GuardOptions } from '@pennydrop/fetch';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.ts';
import { labelFromUrl } from './watches.ts';

const idParams = z.object({ id: z.uuid() });
const ruleParams = z.object({ id: z.uuid(), kind: z.enum(RULE_KINDS) });
const inboxQuery = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const readBody = z.strictObject({ ids: z.array(z.uuid()).max(500).optional() });

export interface AlertRouteDeps {
  db: Db;
  config: Config;
  mail: Mailer;
}

/** Development: the practice shop's catcher answers for *.localhost; elsewhere, only public addresses. */
export function sendGuard(config: Pick<Config, 'localShopHost'>): GuardOptions {
  const local = config.localShopHost;
  return local
    ? {
        allowPrivate: (host) => host.endsWith('.localhost'),
        resolveAs: (host) => (host.endsWith('.localhost') ? local : undefined),
      }
    : {};
}

/** Channels, rules and the alert inbox: all inside the signed-in workspace. */
export async function alertRoutes(app: FastifyInstance, { db, config, mail }: AlertRouteDeps) {
  const key = channelKey(config.channelsKey);
  const notFound = (reply: FastifyReply, what = 'channel') =>
    reply.code(404).send({ error: `We couldn’t find that ${what}.` });

  const channelOf = (c: {
    id: string;
    kind: ChannelSummary['kind'];
    name: string;
    hint: string;
    status: ChannelSummary['status'];
    lastError: string | null;
    lastSentAt: Date | null;
  }): ChannelSummary => ({
    id: c.id,
    kind: c.kind,
    name: c.name,
    hint: c.hint,
    status: c.status,
    lastError: c.lastError,
    lastSentAt: c.lastSentAt?.toISOString() ?? null,
  });

  async function findChannel(workspaceId: string, params: unknown) {
    const parsed = idParams.safeParse(params);
    return parsed.success
      ? db.channel.findFirst({ where: { id: parsed.data.id, workspaceId } })
      : null;
  }

  app.get('/api/channels', async (request) => {
    const channels = await db.channel.findMany({
      where: { workspaceId: request.member!.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return { channels: channels.map(channelOf) };
  });

  app.post('/api/channels', async (request, reply) => {
    const input = channelSchema.parse(request.body ?? {});
    // A demo can't become a way to post into other people's Slack or Discord.
    const { isDemo } = await db.workspace.findUniqueOrThrow({
      where: { id: request.member!.workspaceId },
      select: { isDemo: true },
    });
    if (isDemo && input.kind !== 'email') {
      return reply.code(422).send({ error: 'The demo sends alerts by email only.', field: 'kind' });
    }
    const checked = settingsFor(input, { local: config.localShops });
    if (!checked.ok) return reply.code(422).send({ error: checked.error, field: 'url' });
    const channel = await db.channel.create({
      data: {
        workspaceId: request.member!.workspaceId,
        kind: input.kind,
        name: input.name,
        settings: seal(checked.settings, key),
        hint: hintFor(checked.settings),
      },
    });
    // A webhook's signing secret is shown once, now, for its receiver to check signatures with.
    const secret = checked.settings.kind === 'webhook' ? checked.settings.secret : undefined;
    return reply.code(201).send({ channel: channelOf(channel), ...(secret ? { secret } : {}) });
  });

  app.patch('/api/channels/:id', async (request, reply) => {
    const channel = await findChannel(request.member!.workspaceId, request.params);
    if (!channel) return notFound(reply);
    const { name } = z
      .strictObject({ name: z.string().trim().min(1).max(60) })
      .parse(request.body ?? {});
    const updated = await db.channel.update({ where: { id: channel.id }, data: { name } });
    return { channel: channelOf(updated) };
  });

  app.delete('/api/channels/:id', async (request, reply) => {
    const channel = await findChannel(request.member!.workspaceId, request.params);
    if (!channel) return notFound(reply);
    await db.channel.delete({ where: { id: channel.id } });
    return reply.code(204).send();
  });

  // A test message, sent now: it's how someone knows the address works. Success also mends a broken channel.
  app.post('/api/channels/:id/test', async (request, reply) => {
    const channel = await findChannel(request.member!.workspaceId, request.params);
    if (!channel) return notFound(reply);
    const settings = open<ChannelSettings>(channel.settings, key);
    const now = new Date().toISOString();
    const { isDemo } = await db.workspace.findUniqueOrThrow({
      where: { id: channel.workspaceId },
      select: { isDemo: true },
    });
    const message = compose({
      demo: isDemo,
      test: true,
      alertId: `test-${channel.id}`,
      label: 'A test from Pennydrop',
      host: 'pennydrop',
      url: config.appUrl,
      link: `${config.appUrl}/app/channels`,
      price: 1999,
      currency: 'GBP',
      kinds: [],
      reasons: [`“${channel.name}” is set up: alerts will arrive here.`],
      firedAt: now,
    });
    const result = await send(settings, message, `test-${Date.now()}`, {
      mail,
      guard: sendGuard(config),
      userAgent: 'Pennydrop/1.0 (+alerts)',
    });
    await db.channel.update({
      where: { id: channel.id },
      data: result.ok
        ? { status: 'active', failures: 0, lastError: null, lastSentAt: new Date() }
        : { lastError: result.error },
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  // ---- Rules, on one product ----

  async function findWatch(workspaceId: string, id: string) {
    return db.watch.findFirst({ where: { id, workspaceId }, select: { id: true, isMine: true } });
  }
  const ruleOf = (r: {
    id: string;
    kind: RuleSummary['kind'];
    threshold: number | null;
    armed: boolean;
    lastFiredAt: Date | null;
  }): RuleSummary => ({
    id: r.id,
    kind: r.kind,
    threshold: r.threshold,
    armed: r.armed,
    lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
  });

  app.get('/api/watches/:id/rules', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const watch = params.success
      ? await findWatch(request.member!.workspaceId, params.data.id)
      : null;
    if (!watch) return notFound(reply, 'product');
    const rules = await db.alertRule.findMany({
      where: { watchId: watch.id },
      orderBy: { createdAt: 'asc' },
    });
    return { rules: rules.map(ruleOf) };
  });

  // Turns a rule on, or changes its threshold.
  app.put('/api/watches/:id/rules/:kind', async (request, reply) => {
    const params = ruleParams.safeParse(request.params);
    const watch = params.success
      ? await findWatch(request.member!.workspaceId, params.data.id)
      : null;
    if (!params.success || !watch) return notFound(reply, 'product');
    const { kind, threshold } = ruleSchema.parse({
      ...(request.body as object),
      kind: params.data.kind,
    });
    if (kind === 'undercut' && !watch.isMine) {
      return reply.code(422).send({
        error: 'Mark this listing as your own, in a group, to hear who undercuts it.',
        field: 'kind',
      });
    }
    const rule = await db.alertRule.upsert({
      where: { watchId_kind: { watchId: watch.id, kind } },
      create: { watchId: watch.id, kind, threshold: threshold ?? null },
      update: { threshold: threshold ?? null },
    });
    return { rule: ruleOf(rule) };
  });

  app.delete('/api/watches/:id/rules/:kind', async (request, reply) => {
    const params = ruleParams.safeParse(request.params);
    const watch = params.success
      ? await findWatch(request.member!.workspaceId, params.data.id)
      : null;
    if (!params.success || !watch) return notFound(reply, 'product');
    await db.alertRule.deleteMany({ where: { watchId: watch.id, kind: params.data.kind } });
    return reply.code(204).send();
  });

  // ---- The inbox ----

  app.get('/api/alerts', async (request) => {
    const { workspaceId } = request.member!;
    const { before, limit } = inboxQuery.parse(request.query);
    const rows = await db.alert.findMany({
      where: { workspaceId, ...(before ? { firedAt: { lt: new Date(before) } } : {}) },
      orderBy: { firedAt: 'desc' },
      take: limit + 1,
      include: {
        watch: { include: { target: { include: { site: { select: { host: true } } } } } },
        deliveries: {
          include: { channel: { select: { name: true, kind: true } } },
          orderBy: { channel: { createdAt: 'asc' } },
        },
      },
    });
    const page = rows.slice(0, limit);
    const alerts: AlertSummary[] = page.map((a) => ({
      id: a.id,
      watchId: a.watchId,
      label: a.watch.label ?? a.watch.target.title ?? labelFromUrl(a.watch.target.url),
      host: a.watch.target.site.host,
      kinds: a.kinds,
      price: a.price === null ? null : Number(a.price),
      previousPrice: a.previousPrice === null ? null : Number(a.previousPrice),
      currency: a.currency,
      reasons: a.reasons,
      verified: a.verified,
      firedAt: a.firedAt.toISOString(),
      readAt: a.readAt?.toISOString() ?? null,
      deliveries: a.deliveries.map((d) => ({
        channel: d.channel.name,
        kind: d.channel.kind,
        status: d.status,
      })),
    }));
    return { alerts, next: rows.length > limit ? page.at(-1)!.firedAt.toISOString() : null };
  });

  app.get('/api/alerts/unread', async (request) => ({
    count: await db.alert.count({
      where: { workspaceId: request.member!.workspaceId, readAt: null },
    }),
  }));

  // Marks some alerts read, or all of them when no ids are given.
  app.post('/api/alerts/read', async (request) => {
    const { ids } = readBody.parse(request.body ?? {});
    const { count } = await db.alert.updateMany({
      where: {
        workspaceId: request.member!.workspaceId,
        readAt: null,
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { read: count };
  });
}
