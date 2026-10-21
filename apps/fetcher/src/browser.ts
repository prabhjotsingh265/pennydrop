import { chromium, type Browser } from 'playwright';
import type { GuardOptions } from '@pennydrop/fetch';
import { PRICE_BOXES_SCRIPT, type PriceBox } from './boxes.ts';
import { REFUSED_HEADER, startEgressProxy, type EgressProxy } from './egress-proxy.ts';

export interface RenderOptions {
  userAgent: string;
  /** For the screenshot people pick the price from: images load and a picture is taken. */
  forPeople?: boolean;
  navigationTimeoutMs?: number;
  /** After the page loads, wait at most this long for its network to go quiet. */
  settleMs?: number;
  /** The whole render, start to finish. Past it, the page is torn down. */
  deadlineMs?: number;
}

export interface RenderedPage {
  url: string;
  status: number | null;
  html: string;
  boxes: PriceBox[];
  /** JPEG, when rendered for people. */
  screenshot: Buffer | null;
  screenshotHeight: number;
  /** The page as the shop served it, before any script ran. Kept when rendered for people. */
  source: string | null;
  /** Requests from the page the address guard refused. */
  blocked: number;
  timings: { navigate: number; settle: number; total: number };
}

export class RenderError extends Error {
  readonly code: 'blocked-address' | 'timeout' | 'network';
  constructor(code: RenderError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

const VIEWPORT = { width: 1280, height: 900 };
export const SCREENSHOT_WIDTH = 1280;
export const SCREENSHOT_HEIGHT = 2000;

/**
 * One Chromium, shared by every render and restarted every few hundred pages
 * (browsers grow). Each render gets a fresh context: no cookies, storage or
 * cache carried from one shop to the next. All of its traffic goes through
 * the egress proxy, so the address guard applies to every request it makes.
 */
export class BrowserPool {
  readonly #guard: GuardOptions;
  readonly #recycleAfter: number;
  #browser: Promise<Browser> | null = null;
  #proxy: Promise<EgressProxy> | null = null;
  #renders = 0;
  launches = 0;

  constructor(guard: GuardOptions, recycleAfter = 200) {
    this.#guard = guard;
    this.#recycleAfter = recycleAfter;
  }

  #egress(): Promise<EgressProxy> {
    this.#proxy ??= startEgressProxy(this.#guard);
    return this.#proxy;
  }

  async #launch(): Promise<Browser> {
    if (this.#browser && this.#renders >= this.#recycleAfter) {
      const old = this.#browser;
      this.#browser = null;
      this.#renders = 0;
      await (await old).close().catch(() => {});
    }
    if (!this.#browser) {
      const proxy = await this.#egress();
      this.launches++;
      this.#browser = chromium
        .launch({
          headless: true,
          // "<-loopback>" sends even localhost through the proxy; Chromium skips it otherwise.
          proxy: { server: proxy.url, bypass: '<-loopback>' },
          args: [
            '--disable-dev-shm-usage',
            '--disable-background-networking',
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
            '--webrtc-ip-handling-policy=disable_non_proxied_udp',
          ],
        })
        .then((browser) => {
          browser.on('disconnected', () => {
            this.#browser = null;
          });
          return browser;
        });
    }
    return this.#browser;
  }

  async render(url: string, options: RenderOptions): Promise<RenderedPage> {
    const {
      forPeople = false,
      navigationTimeoutMs = 30_000,
      settleMs = 3_000,
      deadlineMs = 45_000,
    } = options;
    const browser = await this.#launch();
    const proxy = await this.#egress();
    this.#renders++;
    const blockedBefore = proxy.blocked();
    const started = performance.now();

    const context = await browser.newContext({
      userAgent: options.userAgent,
      viewport: VIEWPORT,
      locale: 'en-GB',
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new RenderError('timeout', 'The page took too long to render.')),
        deadlineMs,
      );
    });

    const work = async (): Promise<RenderedPage> => {
      if (!forPeople) {
        // Checks only need the price: skip the heavy, slow parts of the page.
        await context.route('**/*', (route) =>
          ['image', 'media', 'font'].includes(route.request().resourceType())
            ? route.abort('blockedbyclient')
            : route.continue(),
        );
      }
      const page = await context.newPage();
      page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}));

      let response;
      try {
        response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: navigationTimeoutMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY/.test(message) &&
          proxy.blocked() > blockedBefore
        ) {
          throw new RenderError('blocked-address', `${url} isn't a public address.`);
        }
        if (/Timeout/i.test(message))
          throw new RenderError('timeout', 'The page took too long to load.');
        throw new RenderError('network', message);
      }
      if (response?.headers()[REFUSED_HEADER]) {
        throw new RenderError('blocked-address', `${url} isn't a public address.`);
      }
      const navigated = performance.now();

      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: settleMs }).catch(() => {});
      const settled = performance.now();

      const boxes = (await page.evaluate(PRICE_BOXES_SCRIPT)) as PriceBox[];
      const html = await page.content();
      let screenshot: Buffer | null = null;
      let screenshotHeight = 0;
      let source: string | null = null;
      if (forPeople) {
        const height = (await page.evaluate('document.documentElement.scrollHeight')) as number;
        screenshotHeight = Math.min(height, SCREENSHOT_HEIGHT);
        screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 70,
          fullPage: true,
          clip: { x: 0, y: 0, width: VIEWPORT.width, height: screenshotHeight },
        });
        // What a plain request would have got: is the browser needed at all?
        source = (await response?.text().catch(() => null)) ?? null;
      }

      return {
        url: page.url(),
        status: response?.status() ?? null,
        html,
        boxes,
        screenshot,
        screenshotHeight,
        source,
        blocked: proxy.blocked() - blockedBefore,
        timings: {
          navigate: navigated - started,
          settle: settled - navigated,
          total: performance.now() - started,
        },
      };
    };

    try {
      return await Promise.race([work(), deadline]);
    } finally {
      clearTimeout(timer);
      await context.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    const browser = this.#browser;
    const proxy = this.#proxy;
    this.#browser = null;
    this.#proxy = null;
    if (browser) await (await browser).close().catch(() => {});
    if (proxy) await (await proxy).close();
  }
}
