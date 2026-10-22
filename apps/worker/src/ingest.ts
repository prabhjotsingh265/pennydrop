import type { CheckOutcome, Db, EventKind, Prisma, TargetStatus } from '@pennydrop/db';
import { checkJobId, type CheckReport, type FetchJob, type IngestJob } from '@pennydrop/queue';
import type { Queue } from 'bullmq';
import { jobOptions } from './dispatch.ts';
import { retryDelay } from './schedule.ts';

/** A move of more than half the price is checked twice before it's believed. */
const SUSPICIOUS_MOVE = 0.5;
const CONFIRM_AFTER_MS = 120_000;
/** Three in a row and a product is "gone" or "blocked" rather than unlucky. */
const GIVE_UP_AFTER = 3;

const SUCCESS = new Set<CheckOutcome>(['ok', 'unchanged', 'suspicious']);
const COMES_BACK = new Set<TargetStatus>(['needs_attention', 'blocked', 'gone']);
const RETRYABLE = new Set<CheckOutcome>([
  'timeout',
  'network_error',
  'http_error',
  'rate_limited',
  'blocked',
]);

export interface IngestDeps {
  db: Db;
  queues: { http: Queue<FetchJob>; browser: Queue<FetchJob> };
  now?: () => number;
  random?: () => number;
}

export interface IngestResult {
  /** False when this check had already been recorded (the job ran twice). */
  recorded: boolean;
  outcome: CheckOutcome;
  /** A new price point was written. */
  priceChanged: boolean;
  events: EventKind[];
}

type Reading = { price: bigint; was: bigint | null; currency: string; inStock: boolean };

const big = (value: number | null) => (value === null ? null : BigInt(value));

function isSuspicious(
  last: { price: bigint | null; currency: string } | null,
  reading: Reading,
): boolean {
  if (!last || last.price === null) return false;
  if (last.currency !== reading.currency) return true;
  const before = Number(last.price);
  return Math.abs(Number(reading.price) - before) / before > SUSPICIOUS_MOVE;
}

/**
 * Records one check: the check log, price history as change points, healing,
 * the site's robots.txt and breaker, and what happens next to the product.
 * Runs in a transaction with the product's row locked, so two results for
 * the same product are written one after the other.
 */
export async function ingest(deps: IngestDeps, data: IngestJob): Promise<IngestResult> {
  const now = deps.now ?? Date.now;
  const { job, report } = data;
  const followUps: { queue: Queue<FetchJob>; job: FetchJob; delay: number; id: string }[] = [];

  const result = await deps.db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM targets WHERE id = ${job.targetId}::uuid FOR UPDATE`;
      const target = await tx.target.findUnique({
        where: { id: job.targetId },
        include: { site: true },
      });
      if (!target)
        return { recorded: false, outcome: report.outcome, priceChanged: false, events: [] };
      if (await tx.check.findUnique({ where: { jobId: data.checkJobId }, select: { id: true } })) {
        return { recorded: false, outcome: report.outcome, priceChanged: false, events: [] };
      }

      const at = new Date(report.finishedAt);
      const events: { kind: EventKind; details: Prisma.InputJsonValue; site?: boolean }[] = [];
      let outcome: CheckOutcome = report.outcome;
      let priceChanged = false;
      const targetUpdate: Prisma.TargetUpdateInput = { lastCheckedAt: at };
      const siteUpdate: Prisma.SiteUpdateInput = {};

      // The price, as a change point.
      const currency = report.currency ?? target.currency;
      const reading: Reading | null =
        report.outcome === 'ok' && report.amount !== null && currency
          ? {
              price: BigInt(report.amount),
              was: big(report.was),
              currency,
              inStock: report.inStock ?? true,
            }
          : null;
      const last = await tx.pricePoint.findFirst({
        where: { targetId: target.id },
        orderBy: { firstSeenAt: 'desc' },
      });
      let pointUpdate: { id: string; lastSeenAt: Date } | null = null;
      let newPoint: Reading | null = null;

      if (reading) {
        const same =
          last &&
          last.price === reading.price &&
          last.wasPrice === reading.was &&
          last.currency === reading.currency &&
          last.inStock === reading.inStock;
        if (same) {
          pointUpdate = { id: last.id, lastSeenAt: at };
          targetUpdate.pendingPrice = null;
          targetUpdate.pendingSince = null;
        } else if (isSuspicious(last, reading) && target.pendingPrice !== reading.price) {
          // Believe it on the second sighting: hold it and look again in two minutes.
          outcome = 'suspicious';
          targetUpdate.pendingPrice = reading.price;
          targetUpdate.pendingSince = at;
          events.push({
            kind: 'suspicious_price',
            details: { from: String(last?.price), to: String(reading.price) },
          });
          const confirm: FetchJob = {
            ...job,
            reason: 'confirm',
            scheduledFor: now() + CONFIRM_AFTER_MS,
          };
          followUps.push({
            queue: job.mode === 'browser' ? deps.queues.browser : deps.queues.http,
            job: confirm,
            delay: CONFIRM_AFTER_MS,
            id: checkJobId(confirm),
          });
        } else {
          newPoint = reading;
          priceChanged = true;
          targetUpdate.currentPrice = reading.price;
          targetUpdate.currency = reading.currency;
          targetUpdate.inStock = reading.inStock;
          targetUpdate.pendingPrice = null;
          targetUpdate.pendingSince = null;
          if (last && last.inStock !== reading.inStock) {
            events.push({ kind: reading.inStock ? 'back_in_stock' : 'out_of_stock', details: {} });
          }
        }
      } else if (outcome === 'unchanged' && last && target.pendingPrice === null) {
        // "Not modified": the page is the one the last price was read from, so that
        // price still holds. (Unless a big jump is still waiting for its second look.)
        pointUpdate = { id: last.id, lastSeenAt: at };
      }

      // Healing: the saved selector broke, but the price was found another way.
      const selector = report.readings.find((r) => r.strategy === 'selector');
      let recipeChange: {
        retire?: string;
        create?: { selector: string; attribute: string | null; source: 'auto' | 'healed' };
      } = {};
      // Selectors belong to the site, so changes to them are made one at a time per site.
      // When many of a site's products were queued with the old selector, the first to
      // come back heals the site; the rest find it already replaced and leave it alone.
      let activeRecipeId: string | null = null;
      if (SUCCESS.has(outcome) && report.locator) {
        await tx.$queryRaw`SELECT id FROM sites WHERE id = ${target.siteId}::uuid FOR UPDATE`;
        const active = await tx.recipe.findFirst({
          where: { siteId: target.siteId, retiredAt: null },
          select: { id: true },
        });
        activeRecipeId = active?.id ?? null;
      }
      if (SUCCESS.has(outcome) && report.locator) {
        // Only a product read before can say the shop changed: a page never read yet (a new
        // product, or a page that isn't one) may simply be built differently.
        if (
          job.recipe &&
          job.recipe.id === activeRecipeId &&
          selector?.status === 'missing' &&
          report.locator !== job.recipe.selector &&
          target.lastSuccessAt !== null
        ) {
          recipeChange = {
            retire: job.recipe.id,
            create: {
              selector: report.locator,
              attribute: report.locatorAttribute,
              source: 'healed',
            },
          };
          const how = report.strategy ?? 'another strategy';
          events.push({
            kind: 'layout_changed',
            details: { selector: job.recipe.selector },
            site: true,
          });
          events.push({
            kind: 'selector_healed',
            details: { from: job.recipe.selector, to: report.locator, how },
            site: true,
          });
        } else if (!job.recipe && !activeRecipeId) {
          recipeChange = {
            create: {
              selector: report.locator,
              attribute: report.locatorAttribute,
              source: 'auto',
            },
          };
        }
      }

      // The site: its robots.txt, whether it needs a browser, its breaker.
      const robots = report.robots;
      if (
        robots &&
        (!target.site.robotsFetchedAt || robots.fetchedAt > target.site.robotsFetchedAt.getTime())
      ) {
        siteUpdate.robotsTxt = robots.body;
        siteUpdate.robotsStatus = robots.status;
        siteUpdate.robotsFetchedAt = new Date(robots.fetchedAt);
        siteUpdate.crawlDelay = report.crawlDelay;
      }
      if (report.mode === 'browser' && outcome === 'ok' && !target.site.needsBrowser) {
        siteUpdate.needsBrowser = true;
        events.push({ kind: 'needs_browser', details: {}, site: true });
      }
      if (report.breaker.change === 'opened') {
        siteUpdate.breakerState = 'open';
        siteUpdate.breakerOpenUntil = new Date(report.breaker.openUntil!);
        events.push({
          kind: 'breaker_opened',
          details: { until: report.breaker.openUntil },
          site: true,
        });
      } else if (report.breaker.change === 'closed') {
        siteUpdate.breakerState = 'closed';
        siteUpdate.breakerOpenUntil = null;
        events.push({ kind: 'breaker_closed', details: {}, site: true });
      }

      // The product: its streak, its status, and when to look next.
      const scheduledNext = target.nextCheckAt.getTime();
      const earlier = (when: number) => {
        if (when < scheduledNext) targetUpdate.nextCheckAt = new Date(when);
      };
      if (SUCCESS.has(outcome)) {
        targetUpdate.lastSuccessAt = at;
        targetUpdate.failureStreak = 0;
        // Its price is readable again: back from needing attention, blocked or gone. A paused one stays paused.
        if (COMES_BACK.has(target.status)) targetUpdate.status = 'active';
        if (report.etag !== undefined) targetUpdate.etag = report.etag;
        if (report.lastModified !== undefined) targetUpdate.lastModified = report.lastModified;
      } else if (report.wantsBrowser) {
        // Not in the HTML: try it in a browser straight away. It isn't a failure yet.
        const escalated: FetchJob = { ...job, mode: 'browser' };
        followUps.push({
          queue: deps.queues.browser,
          job: escalated,
          delay: 0,
          id: `${data.checkJobId}-browser`,
        });
      } else if (outcome === 'skipped_breaker_open') {
        if (report.notBefore) earlier(report.notBefore);
      } else {
        const streak = target.failureStreak + 1;
        targetUpdate.failureStreak = streak;
        if (outcome === 'gone' && streak >= GIVE_UP_AFTER) {
          targetUpdate.status = 'gone';
          events.push({ kind: 'gone', details: { status: report.status } });
        } else if (outcome === 'blocked' && streak >= GIVE_UP_AFTER) {
          targetUpdate.status = 'blocked';
          events.push({ kind: 'blocked', details: { status: report.status } });
        } else if (outcome === 'robots_disallowed') {
          targetUpdate.status = 'blocked';
          events.push({ kind: 'robots_disallowed', details: {} });
        } else if (outcome === 'price_not_found' && streak >= GIVE_UP_AFTER) {
          targetUpdate.status = 'needs_attention';
        }
        if (RETRYABLE.has(outcome)) {
          const delay = retryDelay(streak, deps.random);
          if (delay !== null) earlier(Math.max(now() + delay, report.notBefore ?? 0));
        }
      }

      const check = await tx.check.create({
        data: {
          targetId: target.id,
          jobId: data.checkJobId,
          reason: job.reason,
          mode: report.mode,
          scheduledFor: new Date(job.scheduledFor),
          startedAt: new Date(report.startedAt),
          finishedAt: at,
          outcome,
          httpStatus: report.status,
          timings: report.timings,
          strategy: report.strategy,
          confidence: report.confidence,
          price: big(report.amount),
          wasPrice: big(report.was),
          currency: report.currency,
          inStock: report.inStock,
          detail: report.detail,
          screenshotKey: report.screenshot ? data.checkJobId : null,
          readings: {
            strategies: report.readings,
            locator: report.locator,
            conflict: report.conflict,
            worker: report.worker,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      if (pointUpdate)
        await tx.pricePoint.update({
          where: { id: pointUpdate.id },
          data: { lastSeenAt: pointUpdate.lastSeenAt },
        });
      if (newPoint) {
        await tx.pricePoint.create({
          data: {
            targetId: target.id,
            firstSeenAt: at,
            lastSeenAt: at,
            price: newPoint.price,
            wasPrice: newPoint.was,
            currency: newPoint.currency,
            inStock: newPoint.inStock,
            firstCheckId: check.id,
            replayed: job.reason === 'replay',
          },
        });
      }
      if (recipeChange.retire) {
        await tx.recipe.update({
          where: { id: recipeChange.retire },
          data: { retiredAt: at, misses: { increment: 1 } },
        });
      } else if (job.recipe && selector?.status === 'found') {
        await tx.recipe.update({ where: { id: job.recipe.id }, data: { hits: { increment: 1 } } });
      }
      if (recipeChange.create) {
        await tx.recipe.create({
          data: {
            siteId: target.siteId,
            selector: recipeChange.create.selector,
            attribute: recipeChange.create.attribute,
            source: recipeChange.create.source,
          },
        });
      }
      await tx.target.update({ where: { id: target.id }, data: targetUpdate });
      if (Object.keys(siteUpdate).length)
        await tx.site.update({ where: { id: target.siteId }, data: siteUpdate });
      if (events.length) {
        await tx.event.createMany({
          data: events.map((event) => ({
            kind: event.kind,
            details: event.details,
            siteId: target.siteId,
            targetId: event.site ? null : target.id,
            at,
          })),
        });
      }
      return { recorded: true, outcome, priceChanged, events: events.map((e) => e.kind) };
    },
    { timeout: 30_000 },
  );

  // Follow-ups go on the queue only once the record is safely written.
  if (result.recorded) {
    for (const followUp of followUps) {
      await followUp.queue.add('check', followUp.job, {
        ...jobOptions,
        jobId: followUp.id,
        delay: followUp.delay,
      });
    }
  }
  return result;
}

export type { CheckReport };
