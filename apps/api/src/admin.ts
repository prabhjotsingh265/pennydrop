import type { Db } from '@pennydrop/db';
import type { LanesView, SystemView } from '@pennydrop/domain';
import type { Queue } from 'bullmq';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.ts';

const MINUTE = 60_000;
/** Lanes on the System page: the busiest sites, however many there are. */
export const LANES = 8;
const HOUR = 60 * MINUTE;
/** Outcomes that read the page: everything else is "not read" (failed, refused, skipped). */
const READ = ['ok', 'unchanged', 'suspicious'];

export interface AdminDeps {
  db: Db;
  config: Config;
  /** Every queue, by name, to count its jobs and its workers. */
  queues: Record<string, Queue>;
  now: () => number;
}

/** The platform's own people: their email addresses, from ADMIN_EMAILS. */
export function isAdmin(config: Pick<Config, 'adminEmails'>, email: string | undefined): boolean {
  return Boolean(email) && config.adminEmails.includes(email!.toLowerCase());
}

const lanesQuery = z.object({ since: z.coerce.number().int().min(0).optional() });

/** A failure in a line or two: its first line says what failed, its last says why. */
export function briefly(reason: string): string {
  const lines = reason
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.length > 2 ? `${lines[0]} … ${lines.at(-1)}` : lines.join(' ');
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

/**
 * The System page: how the whole platform is doing. Anyone else is told it
 * doesn't exist.
 */
export async function adminRoutes(dashboard: FastifyInstance, deps: AdminDeps) {
  const { db, queues } = deps;
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAdmin(deps.config, request.member?.email)) {
      return reply.code(404).send({ error: 'Not found.' });
    }
  };

  dashboard.get('/api/admin/system', { preHandler: guard }, async () => {
    const now = deps.now();
    const hourAgo = new Date(now - HOUR);
    const queueRows = await Promise.all(
      Object.entries(queues).map(async ([name, queue]) => {
        const counts = await queue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'prioritized',
          'failed',
        );
        return {
          name,
          waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          workers: (await queue.getWorkers()).length,
        };
      }),
    );

    const throughput = await db.$queryRaw<{ minute: Date; read: number; notRead: number }[]>`
      SELECT date_trunc('minute', finished_at) AS minute,
             count(*) FILTER (WHERE outcome::text = ANY(${READ}))::int AS "read",
             count(*) FILTER (WHERE NOT outcome::text = ANY(${READ}))::int AS "notRead"
      FROM checks
      WHERE finished_at > ${hourAgo} AND reason <> 'replay'
      GROUP BY 1 ORDER BY 1`;

    // Products due and not yet checked: how far behind the schedule is.
    const [due] = await db.$queryRaw<{ count: number; oldest: Date | null }[]>`
      SELECT count(*)::int AS count, min(t.next_check_at) AS oldest
      FROM targets t JOIN sites s ON s.id = t.site_id
      WHERE s.policy = 'allowed' AND t.status IN ('active', 'needs_attention')
        AND t.next_check_at <= ${new Date(now)}`;

    const sites = await db.$queryRaw<
      {
        host: string;
        breakerState: string;
        breakerOpenUntil: Date | null;
        products: number;
        read: number;
        notRead: number;
      }[]
    >`
      SELECT s.host, s.breaker_state::text AS "breakerState", s.breaker_open_until AS "breakerOpenUntil",
             (SELECT count(*)::int FROM targets t WHERE t.site_id = s.id AND t.status <> 'paused') AS products,
             count(c.id) FILTER (WHERE c.outcome::text = ANY(${READ}))::int AS "read",
             count(c.id) FILTER (WHERE NOT c.outcome::text = ANY(${READ}))::int AS "notRead"
      FROM sites s
      LEFT JOIN targets t ON t.site_id = s.id
      LEFT JOIN checks c ON c.target_id = t.id AND c.finished_at > ${hourAgo} AND c.reason <> 'replay'
      GROUP BY s.id
      ORDER BY count(c.id) DESC, s.host
      LIMIT 12`;

    const failed = (
      await Promise.all(
        Object.entries(queues).map(async ([name, queue]) =>
          (await queue.getFailed(0, 4)).map((job) => ({
            queue: name,
            id: job.id ?? '',
            reason: briefly(job.failedReason ?? ''),
            at: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          })),
        ),
      )
    )
      .flat()
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      .slice(0, 10);

    const [demos, sandboxes, visitors] = await Promise.all([
      db.workspace.count({ where: { isDemo: true, expiresAt: { gt: new Date(now) } } }),
      db.site.count({ where: { host: { startsWith: 'sandbox-' } } }),
      db.user.count({ where: { isAnonymous: true } }),
    ]);

    const view: SystemView = {
      at: new Date(now).toISOString(),
      queues: queueRows,
      throughput: throughput.map((row) => ({ ...row, minute: row.minute.toISOString() })),
      due: { count: due?.count ?? 0, lagMs: due?.oldest ? now - due.oldest.getTime() : 0 },
      sites: sites.map((site) => ({
        ...site,
        breakerOpenUntil: site.breakerOpenUntil?.toISOString() ?? null,
      })),
      failed,
      demo: { active: demos, sandboxes, visitors },
    };
    return view;
  });

  // The lanes: every check since the last look, newest last, and each site's breaker.
  dashboard.get('/api/admin/lanes', { preHandler: guard }, async (request) => {
    const now = deps.now();
    const { since = now - 30_000 } = lanesQuery.parse(request.query);
    const checks = await db.check.findMany({
      where: { finishedAt: { gt: new Date(since) }, reason: { not: 'replay' } },
      orderBy: { finishedAt: 'asc' },
      take: 300,
      select: {
        id: true,
        outcome: true,
        reason: true,
        startedAt: true,
        finishedAt: true,
        target: { select: { site: { select: { host: true } } } },
      },
    });
    // The busiest sites of the last ten minutes (a skipped check counts: its breaker is the
    // story), named in order so the lanes don't jump about as the counts change.
    const busiest = await db.$queryRaw<{ host: string; breaker: string; openUntil: Date | null }[]>`
      SELECT host, breaker, "openUntil" FROM (
        SELECT s.host, s.breaker_state::text AS breaker, s.breaker_open_until AS "openUntil",
               count(c.id) AS checks
        FROM sites s
        JOIN targets t ON t.site_id = s.id
        JOIN checks c ON c.target_id = t.id
        WHERE c.finished_at > ${new Date(now - 10 * MINUTE)} AND c.reason <> 'replay'
        GROUP BY s.id
        ORDER BY checks DESC, s.host
        LIMIT ${LANES}
      ) AS lanes
      ORDER BY host`;
    const view: LanesView = {
      at: now,
      checks: checks.map((check) => ({
        id: check.id,
        host: check.target.site.host,
        outcome: check.outcome,
        read: READ.includes(check.outcome),
        reason: check.reason,
        ms: check.finishedAt.getTime() - check.startedAt.getTime(),
        at: check.finishedAt.getTime(),
      })),
      sites: busiest.map((site) => ({
        host: site.host,
        breaker: site.breaker,
        openUntil: site.openUntil?.toISOString() ?? null,
      })),
    };
    return view;
  });

  // The nightly chores, now: old checks and screenshots pruned, ended demos deleted.
  dashboard.post('/api/admin/maintenance', { preHandler: guard }, async (_request, reply) => {
    const chores = queues.maintenance;
    if (!chores) return reply.code(503).send({ error: 'The maintenance queue isn’t here.' });
    await chores.add('now', {}, { removeOnComplete: true, removeOnFail: 100 });
    return reply.code(202).send({ queued: true });
  });
}
