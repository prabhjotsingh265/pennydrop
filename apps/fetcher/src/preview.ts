import {
  elementAt,
  extract,
  firstElement,
  loadPage,
  parsePrice,
  pathOf,
  selectorFor,
  type Extraction,
} from '@pennydrop/extract';
import {
  PREVIEW_KEEP_S,
  previewScreenshotKey,
  type Breaker,
  type PreviewChoice,
  type PreviewJob,
  type PreviewResult,
  type Redis,
  type SiteGate,
} from '@pennydrop/queue';
import { DelayedError, type Job } from 'bullmq';
import type { PriceBox } from './boxes.ts';
import { SCREENSHOT_WIDTH } from './browser.ts';
import type { createChecker } from './check.ts';
import { SITE_FAILURES, SITE_HEALTHY } from './worker.ts';

/** More than this and the screenshot is a sea of boxes; the extractor's pick is always kept. */
const MAX_CHOICES = 40;

/**
 * Every visible price on the screenshot, as something to click, with the
 * extractor's pick marked. Each comes with a selector for its element, so a
 * different pick can be saved as the site's way to read its price.
 */
export function choicesFrom(
  html: string,
  boxes: readonly PriceBox[],
  extraction: Extraction | null,
  screenshotHeight: number,
): { choices: PreviewChoice[]; selectors: string[] } {
  const page = loadPage(html);
  const hints = { currency: extraction?.currency ?? null };
  let bestPath: string | null = null;
  if (extraction?.locator && !extraction.locatorAttribute) {
    const element = firstElement(page, extraction.locator);
    if (element) bestPath = pathOf(element).join('.');
  }

  const found = boxes.flatMap((box) => {
    if (!box.visible || box.y + box.height > screenshotHeight) return [];
    const price = parsePrice(box.text, hints);
    const element = elementAt(page, box.path);
    if (!price || !element) return [];
    return [{ box, price, selector: selectorFor(page.$, element), path: box.path.join('.') }];
  });

  let best = found.findIndex((item) => item.path === bestPath);
  if (best < 0 && extraction?.amount != null) {
    // Read from structured data rather than an element: box the biggest matching price.
    let size = -1;
    found.forEach((item, index) => {
      if (item.price.amount === extraction.amount && !item.box.struck && item.box.fontSize > size) {
        best = index;
        size = item.box.fontSize;
      }
    });
  }

  const kept = found
    .map((item, index) => ({ ...item, best: index === best }))
    .filter((item, index) => item.best || index < MAX_CHOICES);
  return {
    choices: kept.map(({ box, price, best }) => ({
      text: box.text,
      amount: price.amount,
      currency: price.currency,
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
      struck: box.struck,
      best,
    })),
    selectors: kept.map((item) => item.selector),
  };
}

/** The product's name: its main heading, or failing that the page's title. */
export function titleFrom(html: string): string | null {
  const page = loadPage(html);
  const heading = page.title ? page.$(page.title).text() : '';
  const text = (heading || page.$('title').first().text()).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : null;
}

export interface PreviewDeps {
  checker: ReturnType<typeof createChecker>;
  gate: SiteGate;
  breaker: Breaker;
  /** Where the screenshot is kept for the API to serve. */
  redis: Redis;
  leaseMs?: number;
  now?: () => number;
}

/**
 * Renders a product page for someone adding it. Like a check, it waits its
 * turn at the site's gate and respects robots.txt and the breaker; unlike a
 * check, its result goes back to the person waiting rather than to the
 * database, and it is never retried.
 */
export function createPreviewProcessor(deps: PreviewDeps) {
  const now = deps.now ?? Date.now;
  const leaseMs = deps.leaseMs ?? 120_000;

  return async (job: Job<PreviewJob>, token?: string): Promise<PreviewResult> => {
    const data = job.data;
    const id = job.id!;
    const empty = {
      url: data.url,
      title: null,
      amount: null,
      currency: null,
      was: null,
      inStock: null,
      choices: [],
      selectors: [],
      plainHtmlWorks: null,
      screenshot: null,
      timings: {},
    };

    const decision = await deps.breaker.allow(data.host, id);
    if (!decision.go) {
      const minutes = Math.max(1, Math.ceil((decision.retryAt - now()) / 60_000));
      return {
        ...empty,
        outcome: 'skipped_breaker_open',
        detail: `This shop has been failing, so it’s being left alone for a while. Try again in ${minutes} min.`,
      };
    }
    const wait = await deps.gate.acquire(
      data.host,
      { gapMs: data.gapMs, maxInFlight: data.maxInFlight, leaseMs },
      id,
    );
    if (wait > 0) {
      await job.updateProgress({ step: 'waiting' });
      await job.moveToDelayed(now() + wait, token);
      throw new DelayedError();
    }

    try {
      await job.updateProgress({ step: 'opening' });
      const result = await deps.checker.check({
        url: data.url,
        forPeople: true,
        robots: data.robots,
      });
      const health = SITE_FAILURES.has(result.outcome)
        ? false
        : SITE_HEALTHY.has(result.outcome)
          ? true
          : null;
      if (health !== null) await deps.breaker.report(data.host, health);

      let screenshot: PreviewResult['screenshot'] = null;
      if (result.screenshot) {
        await deps.redis.set(previewScreenshotKey(id), result.screenshot, 'EX', PREVIEW_KEEP_S);
        screenshot = { width: SCREENSHOT_WIDTH, height: result.screenshotHeight };
      }
      const extraction = result.extraction;
      // Prices to pick from only when the page is a product whose price wasn't sure:
      // never on a page that's refused us, gone, or lists many products.
      const pickable = result.outcome === 'ok' || result.outcome === 'price_not_found';
      const { choices, selectors } =
        result.html && pickable
          ? choicesFrom(result.html, result.boxes, extraction, result.screenshotHeight)
          : { choices: [], selectors: [] };
      const amount = extraction?.amount ?? null;
      const plain = result.source && amount !== null ? extract({ html: result.source }) : null;

      return {
        ...empty,
        outcome: result.outcome,
        detail: result.detail,
        url: result.url,
        title: result.html ? titleFrom(result.html) : null,
        amount,
        currency: extraction?.currency ?? null,
        was: extraction?.was ?? null,
        inStock: extraction?.inStock ?? null,
        choices,
        selectors,
        plainHtmlWorks: plain ? plain.amount === amount : null,
        screenshot,
        timings: result.timings,
      };
    } finally {
      await deps.gate.release(data.host, id);
    }
  };
}
