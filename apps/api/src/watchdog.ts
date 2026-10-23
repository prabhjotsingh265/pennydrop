import { emailHtml, type Mailer } from '@pennydrop/alerts';
import type { Db } from '@pennydrop/db';
import type { Redis } from '@pennydrop/queue';
import type { Job, Queue } from 'bullmq';
import type { Config } from './config.ts';

const MINUTE = 60_000;
/** Practice products are checked every 15 minutes, so a healthy Pennydrop reads a page in that time. */
export const NO_READ_MS = 15 * MINUTE;
/** How late the schedule or a queue may run before it counts as behind. */
export const BEHIND_MS = 10 * MINUTE;
/** Backups are daily: a day and two hours allows for a slow one. */
export const BACKUP_LATE_MS = 26 * 60 * MINUTE;
/** A problem must last this long before anyone is told: a deploy's restart doesn't count. */
export const GRACE_MS = 2 * MINUTE;
/** Outcomes that read the page, as on the System page. */
const READ = ['ok', 'unchanged', 'suspicious'];

/** How the whole platform is doing, in the numbers the watchdog judges. */
export interface Vitals {
  /** When a check last read a page (replays aside), in the last day. */
  lastRead: number | null;
  /** A product has been watched for 15 minutes at a 15-minute interval, so a read is due. */
  expectsReads: boolean;
  /** When the most overdue product fell due, if any is waiting for the dispatcher. */
  oldestDue: number | null;
  queues: { name: string; workers: number; oldestReady: number | null }[];
  /** When the newest backup was taken, if backups are made here at all. */
  lastBackup: number | null;
}

export interface Problem {
  /** Stays the same while the problem lasts, however its text changes. */
  id: string;
  text: string;
}

const minutes = (ms: number) => {
  const m = Math.floor(ms / MINUTE);
  return m === 1 ? '1 minute' : `${m} minutes`;
};
const hours = (ms: number) => `${Math.floor(ms / (60 * MINUTE))} hours`;

/** What's wrong now. */
export function problemsIn(vitals: Vitals, now: number): Problem[] {
  const problems: Problem[] = [];
  if (vitals.expectsReads && (vitals.lastRead === null || now - vitals.lastRead > NO_READ_MS)) {
    problems.push({
      id: 'reads',
      text:
        vitals.lastRead === null
          ? 'No check has read a page in the last day.'
          : `No check has read a page for ${minutes(now - vitals.lastRead)}.`,
    });
  }
  if (vitals.oldestDue !== null && now - vitals.oldestDue > BEHIND_MS) {
    problems.push({
      id: 'schedule',
      text: `The schedule is ${minutes(now - vitals.oldestDue)} behind: products are due, and no checks are being queued for them.`,
    });
  }
  for (const queue of vitals.queues) {
    if (queue.workers === 0) {
      problems.push({
        id: `workers:${queue.name}`,
        text: `No worker is taking ${queue.name} jobs.`,
      });
    } else if (queue.oldestReady !== null && now - queue.oldestReady > BEHIND_MS) {
      problems.push({
        id: `queue:${queue.name}`,
        text: `The ${queue.name} queue is ${minutes(now - queue.oldestReady)} behind.`,
      });
    }
  }
  if (vitals.lastBackup !== null && now - vitals.lastBackup > BACKUP_LATE_MS) {
    problems.push({
      id: 'backup',
      text: `The newest database backup is ${hours(now - vitals.lastBackup)} old.`,
    });
  }
  return problems;
}

/**
 * When a waiting job became ready to run. A job put back (for its site's pace, or to retry)
 * keeps its creation time, so its wait counts from when it last ran.
 */
export function readyAt(job: Pick<Job, 'timestamp' | 'processedOn' | 'delay'>): number {
  return (job.processedOn ?? job.timestamp) + (job.delay ?? 0);
}

export interface WatchdogDeps {
  db: Db;
  redis: Redis;
  /** Every queue, by name: each must have a worker, and none may fall behind. */
  queues: Record<string, Queue>;
  mail: Mailer;
  config: Pick<Config, 'adminEmails' | 'appUrl'>;
  now: () => number;
  /** Where in Redis the watchdog keeps what it's seen. */
  prefix?: string;
}

export async function vitalsOf({ db, queues, now: clock }: WatchdogDeps): Promise<Vitals> {
  const now = clock();
  const [read] = await db.$queryRaw<{ at: Date | null }[]>`
    SELECT max(started_at) AS at FROM checks
    WHERE started_at > ${new Date(now - 24 * 60 * MINUTE)} AND reason <> 'replay'
      AND outcome::text = ANY(${READ})`;
  const [expects] = await db.$queryRaw<{ yes: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM targets t JOIN sites s ON s.id = t.site_id
      WHERE s.policy = 'allowed' AND t.status = 'active'
        AND t.interval_seconds * 1000 <= ${NO_READ_MS}
        AND t.created_at < ${new Date(now - NO_READ_MS)}
    ) AS yes`;
  const [due] = await db.$queryRaw<{ oldest: Date | null }[]>`
    SELECT min(t.next_check_at) AS oldest
    FROM targets t JOIN sites s ON s.id = t.site_id
    WHERE s.policy = 'allowed' AND t.status IN ('active', 'needs_attention')
      AND t.next_check_at <= ${new Date(now)}`;
  const [backup] = await db.$queryRaw<{ at: Date | null }[]>`
    SELECT max(taken_at) AS at FROM backups`;
  const queueRows = await Promise.all(
    Object.entries(queues).map(async ([name, queue]) => {
      // The oldest first. Replays wait behind everything else on purpose.
      const waiting = await queue.getJobs(['waiting', 'prioritized'], 0, 99, true);
      const ready = waiting
        .filter((job) => (job.data as { reason?: string } | undefined)?.reason !== 'replay')
        .map(readyAt);
      return {
        name,
        workers: (await queue.getWorkers()).length,
        oldestReady: ready.length ? Math.min(...ready) : null,
      };
    }),
  );
  return {
    lastRead: read?.at?.getTime() ?? null,
    expectsReads: expects?.yes ?? false,
    oldestDue: due?.oldest?.getTime() ?? null,
    queues: queueRows,
    lastBackup: backup?.at?.getTime() ?? null,
  };
}

interface Seen {
  since: number;
  text: string;
  /** The admins have been told. */
  told: boolean;
}

/** One look: the vitals judged, and the admins told what's new. */
export async function watch(deps: WatchdogDeps) {
  return report(deps, problemsIn(await vitalsOf(deps), deps.now()));
}

/**
 * Problems that have lasted past the grace period are emailed to the admins
 * once, and so is their end. What's been seen is kept in Redis, so every API
 * process shares it and a restart forgets nothing.
 */
export async function report(
  deps: WatchdogDeps,
  problems: Problem[],
): Promise<{ told: Problem[]; ended: Problem[] }> {
  const { redis } = deps;
  const now = deps.now();
  const key = `${deps.prefix ?? 'pennydrop:watchdog'}:problems`;
  const seen = new Map(
    Object.entries(await redis.hgetall(key)).map(
      ([id, json]) => [id, JSON.parse(json) as Seen] as const,
    ),
  );

  const current = new Set(problems.map((problem) => problem.id));
  // Ended ones the admins were told of stay until they're told of the end too.
  const ended = [...seen]
    .filter(([id, was]) => !current.has(id) && was.told)
    .map(([id, was]) => ({ id, text: was.text }));
  const lasting: Problem[] = [];
  const next = new Map<string, Seen>(ended.map((problem) => [problem.id, seen.get(problem.id)!]));
  for (const problem of problems) {
    const was = seen.get(problem.id);
    const since = was?.since ?? now;
    if (now - since >= GRACE_MS) lasting.push(problem);
    next.set(problem.id, { since, text: problem.text, told: was?.told ?? false });
  }
  const save = redis.multi().del(key);
  if (next.size) {
    save.hset(key, Object.fromEntries([...next].map(([id, s]) => [id, JSON.stringify(s)])));
  }
  await save.exec();

  // Each step recorded only once its email has gone: a failed send is tried on the next look.
  const news = lasting.filter((problem) => !next.get(problem.id)!.told);
  if (news.length) {
    await tell(deps, 'problem', news, lasting);
    await redis.hset(
      key,
      Object.fromEntries(
        news.map((problem) => [
          problem.id,
          JSON.stringify({ ...next.get(problem.id)!, told: true }),
        ]),
      ),
    );
  }
  if (ended.length) {
    await tell(deps, 'ended', ended, lasting);
    await redis.hdel(key, ...ended.map((problem) => problem.id));
  }
  return { told: news, ended };
}

async function tell(
  { mail, config }: WatchdogDeps,
  kind: 'problem' | 'ended',
  problems: Problem[],
  ongoing: Problem[],
) {
  const texts = problems.map((problem) => problem.text);
  const others = ongoing
    .filter((other) => !problems.some((problem) => problem.id === other.id))
    .map((other) => other.text);
  const more = texts.length > 1 ? ` (and ${texts.length - 1} more)` : '';
  const subject = `${kind === 'problem' ? 'Pennydrop needs a look' : 'Pennydrop is back to normal'}: ${texts[0]}${more}`;
  const lead =
    kind === 'problem' ? 'This has lasted more than two minutes:' : 'This has put itself right:';
  const paragraphs = others.length ? [`Still going on: ${others.join(' ')}`, lead] : [lead];
  const system = `${config.appUrl}/admin`;
  const footer = 'You’re sent this because your address is in ADMIN_EMAILS.';
  // In the logs too, whether or not anyone reads the email.
  (kind === 'problem' ? console.error : console.log)(`watchdog: ${subject}`);
  for (const to of config.adminEmails) {
    await mail({
      to,
      subject,
      text: [...paragraphs, ...texts.map((text) => `- ${text}`), '', system, '', footer].join('\n'),
      html: emailHtml({
        preheader: texts[0]!,
        heading: kind === 'problem' ? 'Pennydrop needs a look' : 'Back to normal',
        paragraphs,
        items: texts,
        button: { label: 'Open the System page', href: system },
        footer,
      }),
    });
  }
}

/** Every minute, in one API process at a time (whichever takes the lock). */
export function startWatchdog(deps: WatchdogDeps, everyMs = MINUTE): () => void {
  const look = async () => {
    const lock = `${deps.prefix ?? 'pennydrop:watchdog'}:lock`;
    const mine = await deps.redis.set(lock, String(process.pid), 'PX', everyMs - 5_000, 'NX');
    if (mine !== 'OK') return;
    await watch(deps);
  };
  const timer = setInterval(() => {
    look().catch((error: unknown) => console.error('watchdog failed:', error));
  }, everyMs);
  return () => clearInterval(timer);
}
