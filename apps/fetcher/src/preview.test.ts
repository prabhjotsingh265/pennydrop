import { randomUUID } from 'node:crypto';
import { extract, firstElement, loadPage, pathOf } from '@pennydrop/extract';
import { Breaker, SiteGate, previewScreenshotKey, redisConnection } from '@pennydrop/queue';
import type { PreviewJob } from '@pennydrop/queue';
import type { Job } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import type { PriceBox } from './boxes.ts';
import type { CheckResult, createChecker } from './check.ts';
import { choicesFrom, createPreviewProcessor, titleFrom } from './preview.ts';

const PAGE = `<!doctype html><html><head><title>Stoneware mug | Fickle</title></head><body>
<main>
  <h1>Stoneware mug</h1>
  <p class="price"><s class="was">£42.00</s> <span class="now">£34.00</span></p>
  <button>Add to basket</button>
  <aside class="related"><h2>You may also like</h2><span class="tile-price">£12.50</span></aside>
  <footer><span class="hidden-price">£1.00</span><span class="far-price">£99.00</span></footer>
</main></body></html>`;

/** Boxes as the browser would report them, for the elements matching each selector. */
function boxesFor(html: string, layout: Record<string, Partial<PriceBox>>): PriceBox[] {
  const page = loadPage(html);
  return Object.entries(layout).map(([selector, box]) => {
    const element = firstElement(page, selector)!;
    return {
      text: page.$(element).text(),
      path: pathOf(element),
      x: 40,
      y: 200,
      width: 90,
      height: 30,
      fontSize: 16,
      fontWeight: 400,
      visible: true,
      struck: false,
      ...box,
    };
  });
}

const BOXES = boxesFor(PAGE, {
  '.was': { y: 180, struck: true },
  '.now': { y: 180, x: 120, fontSize: 32 },
  '.tile-price': { y: 900, fontSize: 14 },
  '.hidden-price': { visible: false },
  '.far-price': { y: 5_000 },
});

describe('choicesFrom', () => {
  it('boxes every visible price on the screenshot and marks the extractor’s pick', () => {
    const extraction = extract({ html: PAGE, boxes: BOXES });
    const { choices, selectors } = choicesFrom(PAGE, BOXES, extraction, 2_000);
    expect(choices.map((c) => [c.text, c.amount, c.struck, c.best])).toEqual([
      ['£42.00', 4200, true, false],
      ['£34.00', 3400, false, true],
      ['£12.50', 1250, false, false],
    ]);
    expect(selectors).toHaveLength(3);
    // Each selector finds its own element again.
    const page = loadPage(PAGE);
    expect(selectors.map((s) => page.$(s).text())).toEqual(['£42.00', '£34.00', '£12.50']);
  });

  it('boxes the biggest matching price when structured data supplied the answer', () => {
    const html = PAGE.replace(
      '<main>',
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        offers: { price: '34.00', priceCurrency: 'GBP' },
      })}</script><main>`,
    );
    const boxes = boxesFor(html, {
      '.now': { fontSize: 32 },
      '.tile-price': {},
    });
    const extraction = { ...extract({ html, boxes }), locator: null, locatorAttribute: null };
    const { choices } = choicesFrom(html, boxes, extraction, 2_000);
    expect(choices.find((c) => c.best)?.text).toBe('£34.00');
  });

  it('still offers the prices when nothing was picked', () => {
    const { choices } = choicesFrom(PAGE, BOXES, null, 2_000);
    expect(choices).toHaveLength(3);
    expect(choices.some((c) => c.best)).toBe(false);
  });
});

describe('titleFrom', () => {
  it('prefers the main heading to the page title', () => {
    expect(titleFrom(PAGE)).toBe('Stoneware mug');
    expect(
      titleFrom('<html><head><title> Kettle  | Shop </title></head><body></body></html>'),
    ).toBe('Kettle | Shop');
  });
});

describe('the preview processor', () => {
  const connection = redisConnection();
  const prefix = `test-${randomUUID()}`;
  const gate = new SiteGate(connection, prefix);
  const breaker = new Breaker(connection, prefix, [60_000]);
  afterAll(async () => {
    const keys = await connection.keys(`${prefix}:*`);
    if (keys.length) await connection.del(...keys);
    await connection.quit();
  });

  const rendered = (extra: Partial<CheckResult> = {}): CheckResult => ({
    outcome: 'ok',
    mode: 'browser',
    status: 200,
    url: 'https://fickle.example.com/p/stoneware-mug',
    extraction: extract({ html: PAGE, boxes: BOXES }),
    neededBrowser: false,
    retryAfterSeconds: null,
    etag: null,
    lastModified: null,
    robots: { status: 'missing', body: '', fetchedAt: 0 },
    crawlDelay: null,
    screenshot: Buffer.from('jpeg bytes'),
    screenshotHeight: 1_400,
    boxes: BOXES,
    html: PAGE,
    // As served, before scripts: here the price is only filled in by JavaScript.
    source: PAGE.replace('£34.00', '').replace('£42.00', ''),
    detail: 'Read in a browser.',
    timings: { robots: 1, http: 0, browser: 500, total: 501 },
    ...extra,
  });
  const fakeJob = (host: string): Job<PreviewJob> => {
    const progress: unknown[] = [];
    return {
      id: randomUUID(),
      data: {
        url: `https://${host}/p/stoneware-mug`,
        host,
        workspaceId: 'w',
        robots: null,
        gapMs: 0,
        maxInFlight: 1,
      },
      progress,
      updateProgress: async (value: unknown) => void progress.push(value),
      moveToDelayed: async () => {},
    } as unknown as Job<PreviewJob>;
  };
  const processor = (result: CheckResult) =>
    createPreviewProcessor({
      checker: { check: async () => result } as ReturnType<typeof createChecker>,
      gate,
      breaker,
      redis: connection,
    });

  it('keeps the screenshot for the API and says the plain HTML isn’t enough', async () => {
    const job = fakeJob('fickle.example.com');
    const result = await processor(rendered())(job);
    expect(result).toMatchObject({
      outcome: 'ok',
      title: 'Stoneware mug',
      amount: 3400,
      currency: 'GBP',
      plainHtmlWorks: false,
      screenshot: { width: 1280, height: 1_400 },
    });
    expect(result.choices.find((c) => c.best)?.amount).toBe(3400);
    expect(await connection.getBuffer(previewScreenshotKey(job.id!))).toEqual(
      Buffer.from('jpeg bytes'),
    );
    expect(await connection.ttl(previewScreenshotKey(job.id!))).toBeGreaterThan(1_700);
    await connection.del(previewScreenshotKey(job.id!));
  });

  it('says when the page as served already holds the price', async () => {
    const result = await processor(rendered({ source: PAGE }))(fakeJob('fickle.example.com'));
    expect(result.plainHtmlWorks).toBe(true);
  });

  it('passes on why a page couldn’t be previewed', async () => {
    const result = await processor(
      rendered({
        outcome: 'robots_disallowed',
        detail: 'robots.txt asks robots not to visit this page.',
        extraction: null,
        screenshot: null,
        html: null,
        source: null,
      }),
    )(fakeJob('fickle.example.com'));
    expect(result).toMatchObject({ outcome: 'robots_disallowed', choices: [], screenshot: null });
  });

  it('leaves a failing shop alone', async () => {
    for (let i = 0; i < 5; i++) await breaker.report('brittle.example.com', false);
    const result = await processor(rendered())(fakeJob('brittle.example.com'));
    expect(result.outcome).toBe('skipped_breaker_open');
    expect(result.detail).toMatch(/Try again in \d+ min/);
  });
});
