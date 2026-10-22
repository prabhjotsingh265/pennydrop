import { extract, type Extraction, type Recipe } from '@pennydrop/extract';
import {
  FetchError,
  fetchPage,
  isFresh,
  robotsRecord,
  robotsUrl,
  robotsVerdict,
  type FetchPageOptions,
  type GuardOptions,
  type RobotsRecord,
} from '@pennydrop/fetch';
import type { PriceBox } from './boxes.ts';
import { RenderError, type BrowserPool } from './browser.ts';

/** How a check ended. The scheduler decides what to do next from this alone. */
export type Outcome =
  | 'ok'
  | 'unchanged'
  | 'price_not_found'
  | 'blocked'
  | 'rate_limited'
  | 'http_error'
  | 'gone'
  | 'robots_disallowed'
  | 'timeout'
  | 'network_error'
  | 'too_large'
  | 'not_html'
  | 'blocked_address';

export interface CheckRequest {
  url: string;
  recipe?: Recipe | null;
  /** auto: plain HTTP first, a browser only if the price isn't in the HTML. */
  mode?: 'auto' | 'http' | 'browser';
  etag?: string | null;
  lastModified?: string | null;
  /** The site's robots.txt, if it was fetched recently. */
  robots?: RobotsRecord | null;
  /** A preview for someone adding the product: rendered in a browser, with a screenshot. */
  forPeople?: boolean;
}

export interface CheckResult {
  outcome: Outcome;
  mode: 'http' | 'browser';
  status: number | null;
  url: string;
  extraction: Extraction | null;
  /** The price only appeared once the page ran its scripts. */
  neededBrowser: boolean;
  retryAfterSeconds: number | null;
  etag: string | null;
  lastModified: string | null;
  robots: RobotsRecord;
  crawlDelay: number | null;
  screenshot: Buffer | null;
  screenshotHeight: number;
  boxes: PriceBox[];
  /** For previews: the rendered page, and the page as served. */
  html: string | null;
  source: string | null;
  /** In words, for the check log. */
  detail: string;
  timings: { robots: number; http: number; browser: number; total: number };
}

export interface CheckerOptions {
  userAgent: string;
  guard: GuardOptions;
  /** Needed for browser checks; without one, auto mode stops at plain HTTP. */
  pool?: BrowserPool;
  /** Timeouts and limits for plain fetches. */
  http?: Partial<FetchPageOptions>;
  now?: () => number;
}

const LISTING =
  'This page lists several products rather than showing one. Open the product itself and use its address.';

const BOT_WALL =
  /\b(captcha|are you a robot|unusual traffic|verify (that )?you are (a )?human|request blocked|bot detection|access denied|please enable (javascript|cookies))\b/i;

/** Retry-After is either seconds or a date; either way, seconds from now, at most a day. */
export function retryAfter(value: string | undefined, now: number): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.min(Math.max(Math.ceil(seconds), 0), 86_400) : null;
}

const FETCH_OUTCOMES: Record<FetchError['code'], Outcome> = {
  'not-http': 'blocked_address',
  'blocked-address': 'blocked_address',
  'blocked-port': 'blocked_address',
  dns: 'network_error',
  network: 'network_error',
  'too-many-redirects': 'network_error',
  timeout: 'timeout',
  'too-large': 'too_large',
  'not-html': 'not_html',
};

const RENDER_OUTCOMES: Record<RenderError['code'], Outcome> = {
  'blocked-address': 'blocked_address',
  timeout: 'timeout',
  network: 'network_error',
};

/** What an HTTP status means for a product check, when it isn't a success. */
function fromStatus(status: number): { outcome: Outcome; detail: string } | null {
  if (status === 404 || status === 410)
    return { outcome: 'gone', detail: `The page is gone (${status}).` };
  if (status === 429)
    return { outcome: 'rate_limited', detail: 'The shop asked us to slow down (429).' };
  if (status === 401 || status === 403)
    return { outcome: 'blocked', detail: `The shop refused the request (${status}).` };
  if (status < 200 || status >= 300)
    return { outcome: 'http_error', detail: `The shop answered ${status}.` };
  return null;
}

export function createChecker(options: CheckerOptions) {
  const now = options.now ?? Date.now;
  const token = options.userAgent.split('/')[0] ?? options.userAgent;
  const fetchOptions: FetchPageOptions = {
    ...options.guard,
    ...options.http,
    userAgent: options.userAgent,
  };

  async function loadRobots(
    url: string,
    cached: RobotsRecord | null | undefined,
  ): Promise<RobotsRecord> {
    if (cached && isFresh(cached, now())) return cached;
    try {
      const page = await fetchPage(robotsUrl(url), {
        ...fetchOptions,
        expect: 'text',
        totalTimeoutMs: 10_000,
      });
      return robotsRecord(page.status, page.body ?? '', now());
    } catch (error) {
      if (error instanceof FetchError && FETCH_OUTCOMES[error.code] === 'blocked_address')
        throw error;
      return robotsRecord(null, '', now());
    }
  }

  async function check(request: CheckRequest): Promise<CheckResult> {
    const started = performance.now();
    const timings = { robots: 0, http: 0, browser: 0, total: 0 };
    let robots = robotsRecord(null, '', now());
    const base = {
      url: request.url,
      status: null as number | null,
      extraction: null as Extraction | null,
      neededBrowser: false,
      retryAfterSeconds: null as number | null,
      etag: request.etag ?? null,
      lastModified: request.lastModified ?? null,
      crawlDelay: null as number | null,
      screenshot: null as Buffer | null,
      screenshotHeight: 0,
      boxes: [] as PriceBox[],
      html: null as string | null,
      source: null as string | null,
    };
    const finish = (
      mode: 'http' | 'browser',
      outcome: Outcome,
      detail: string,
      extra: Partial<CheckResult> = {},
    ): CheckResult => {
      timings.total = performance.now() - started;
      return { ...base, ...extra, mode, outcome, detail, robots, timings };
    };

    // 1. robots.txt, from the last day's copy when there is one.
    try {
      robots = await loadRobots(request.url, request.robots);
    } catch (error) {
      return finish('http', 'blocked_address', (error as Error).message);
    }
    timings.robots = performance.now() - started;
    const verdict = robotsVerdict(robots, request.url, token);
    base.crawlDelay = verdict.crawlDelay;
    if (!verdict.allowed) return finish('http', 'robots_disallowed', verdict.reason);

    // 2. The browser, when we already know it's needed or someone is picking the price.
    const inBrowser = async (escalated: boolean): Promise<CheckResult> => {
      if (!options.pool)
        return finish(
          'http',
          'price_not_found',
          'The price isn’t in the page’s HTML, and no browser is available.',
        );
      const browserStarted = performance.now();
      try {
        const page = await options.pool.render(request.url, {
          userAgent: options.userAgent,
          forPeople: request.forPeople ?? false,
          snapshot: !request.forPeople,
        });
        timings.browser = performance.now() - browserStarted;
        const extra = {
          url: page.url,
          status: page.status,
          screenshot: page.screenshot,
          screenshotHeight: page.screenshotHeight,
          boxes: page.boxes,
          html: request.forPeople ? page.html : null,
          source: page.source,
        };
        const refused = page.status === null ? null : fromStatus(page.status);
        if (refused) return finish('browser', refused.outcome, refused.detail, extra);
        const extraction = extract({ html: page.html, boxes: page.boxes, recipe: request.recipe });
        if (extraction.amount === null && extraction.listing) {
          return finish('browser', 'gone', LISTING, { ...extra, extraction });
        }
        if (extraction.amount === null) {
          const wall = BOT_WALL.test(page.html);
          return finish(
            'browser',
            wall ? 'blocked' : 'price_not_found',
            wall
              ? 'The shop showed a “prove you’re human” page.'
              : 'No price was found, even in a browser.',
            { ...extra, extraction },
          );
        }
        return finish('browser', 'ok', 'Read in a browser.', {
          ...extra,
          // A check that worked keeps no picture; a preview always does.
          screenshot: request.forPeople ? page.screenshot : null,
          extraction,
          neededBrowser: escalated,
        });
      } catch (error) {
        timings.browser = performance.now() - browserStarted;
        if (error instanceof RenderError)
          return finish('browser', RENDER_OUTCOMES[error.code], error.message);
        throw error;
      }
    };

    if (request.forPeople || request.mode === 'browser') return inBrowser(false);

    // 3. Plain HTTP: cheap, and enough for most shops.
    const httpStarted = performance.now();
    let page;
    try {
      page = await fetchPage(request.url, {
        ...fetchOptions,
        etag: request.etag,
        lastModified: request.lastModified,
      });
    } catch (error) {
      timings.http = performance.now() - httpStarted;
      if (error instanceof FetchError)
        return finish('http', FETCH_OUTCOMES[error.code], error.message);
      throw error;
    }
    timings.http = performance.now() - httpStarted;
    base.url = page.url;
    base.status = page.status;
    base.etag = page.headers.etag ?? base.etag;
    base.lastModified = page.headers['last-modified'] ?? base.lastModified;

    if (page.notModified)
      return finish('http', 'unchanged', 'The page hasn’t changed since the last check (304).');
    const refused = fromStatus(page.status);
    if (refused) {
      const wait = page.status === 429 ? retryAfter(page.headers['retry-after'], now()) : null;
      return finish('http', refused.outcome, refused.detail, { retryAfterSeconds: wait });
    }

    const extraction = extract({ html: page.body ?? '', recipe: request.recipe });
    if (extraction.amount !== null)
      return finish('http', 'ok', 'Read from the page’s HTML.', { extraction });
    // A category or home page: no single product here, and a browser wouldn't change that.
    if (extraction.listing) return finish('http', 'gone', LISTING, { extraction });
    if (BOT_WALL.test(page.body ?? '')) {
      return finish('http', 'blocked', 'The shop showed a “prove you’re human” page.', {
        extraction,
      });
    }
    if (request.mode === 'http')
      return finish('http', 'price_not_found', 'No price in the page’s HTML.', { extraction });

    // 4. Not in the HTML: perhaps the page writes it with JavaScript.
    return inBrowser(true);
  }

  return { check };
}
