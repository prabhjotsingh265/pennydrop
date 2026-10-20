import { isIP, type Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { Agent, buildConnector, request } from 'undici';
import { guardedLookup, isPublicAddress, type GuardOptions } from './guard.ts';

export type FetchErrorCode =
  | 'not-http'
  | 'blocked-address'
  | 'blocked-port'
  | 'dns'
  | 'timeout'
  | 'network'
  | 'too-large'
  | 'not-html'
  | 'too-many-redirects';

export class FetchError extends Error {
  readonly code: FetchErrorCode;
  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Milliseconds spent in each step, for the check waterfall. */
export interface Timings {
  dns: number;
  connect: number;
  tls: number;
  firstByte: number;
  download: number;
  total: number;
}

export interface FetchedPage {
  /** Where the page finally came from, after redirects. */
  url: string;
  status: number;
  headers: Record<string, string>;
  /** Null for a 304: the page hasn't changed since the ETag we sent. */
  body: string | null;
  notModified: boolean;
  redirects: string[];
  bytes: number;
  timings: Timings;
}

export interface FetchPageOptions extends GuardOptions {
  userAgent: string;
  etag?: string | null;
  lastModified?: string | null;
  /** 'html' refuses anything that isn't a web page; 'text' is for robots.txt. */
  expect?: 'html' | 'text';
  connectTimeoutMs?: number;
  headersTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Only http(s), only the usual ports, and an address written as an IP must be public. */
function checkTarget(target: string, options: FetchPageOptions): URL {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new FetchError('not-http', `${target} isn't a web address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchError('not-http', `${url.protocol} addresses can't be checked.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const trusted = options.allowPrivate?.(host) ?? false;
  if (!trusted && url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new FetchError('blocked-port', `Port ${url.port} isn't one web pages are served on.`);
  }
  // A literal IP address never reaches DNS, so it's checked here instead.
  if (!trusted && isIP(host) && !isPublicAddress(host)) {
    throw new FetchError('blocked-address', `${host} isn't a public address.`);
  }
  return url;
}

/** One connection per hop, through the guarded lookup, timing DNS, TCP and TLS. */
function hopAgent(options: FetchPageOptions, timings: Timings, connectTimeout: number) {
  let resolvedAt = 0;
  const connector = buildConnector({
    timeout: connectTimeout,
    lookup: guardedLookup(options, (ms) => {
      timings.dns = ms;
      resolvedAt = performance.now();
    }),
  } as Parameters<typeof buildConnector>[0]);

  return new Agent({
    connect: (connectOptions, callback) => {
      const started = performance.now();
      let tcpAt = 0;
      // undici's types say the connector returns nothing; it returns the socket it opened.
      const socket = connector(connectOptions, (error, connected) => {
        if (!error && connectOptions.protocol === 'https:') timings.tls = performance.now() - tcpAt;
        callback(error, connected as never);
      }) as unknown as Socket;
      socket.once('connect', () => {
        tcpAt = performance.now();
        timings.connect = tcpAt - (resolvedAt || started);
      });
      return socket;
    },
  });
}

/** Reads the body, decompressed, and stops the moment it passes the size limit (zip bombs included). */
async function readCapped(
  body: Readable,
  encoding: string | undefined,
  maxBytes: number,
): Promise<Buffer> {
  const stream =
    encoding === 'gzip' || encoding === 'x-gzip'
      ? body.pipe(createGunzip())
      : encoding === 'br'
        ? body.pipe(createBrotliDecompress())
        : encoding === 'deflate'
          ? body.pipe(createInflate())
          : body;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      body.destroy();
      stream.destroy();
      throw new FetchError(
        'too-large',
        `The page is over ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The character set from the header, else a <meta charset>, else UTF-8. */
function decode(bytes: Buffer, contentType: string): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1];
  try {
    return new TextDecoder(declared ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Finds why a request failed, however deep undici wrapped it. */
function classify(error: unknown): FetchError {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof FetchError) return current;
    const { code, name, message } = current as { code?: string; name?: string; message?: string };
    if (code === 'blocked-address') return new FetchError('blocked-address', String(message));
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
      return new FetchError('dns', 'The site’s name doesn’t resolve.');
    if (
      name === 'AbortError' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'UND_ERR_HEADERS_TIMEOUT' ||
      code === 'UND_ERR_BODY_TIMEOUT'
    ) {
      return new FetchError('timeout', 'The site took too long to answer.');
    }
    current = (current as { cause?: unknown }).cause;
  }
  return new FetchError('network', error instanceof Error ? error.message : 'The request failed.');
}

/**
 * Fetches one page the careful way: guarded addresses on every hop, at most
 * five redirects, a time limit on every step, a size limit on the body, and
 * conditional headers so an unchanged page costs the shop almost nothing.
 * Error statuses (403, 429, 5xx) are returned, not thrown: the caller decides
 * what each one means.
 */
export async function fetchPage(target: string, options: FetchPageOptions): Promise<FetchedPage> {
  const {
    expect = 'html',
    connectTimeoutMs = 5_000,
    headersTimeoutMs = 10_000,
    totalTimeoutMs = 20_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 5,
  } = options;
  const started = performance.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), totalTimeoutMs);
  const timings: Timings = { dns: 0, connect: 0, tls: 0, firstByte: 0, download: 0, total: 0 };
  const redirects: string[] = [];

  try {
    let current = target;
    for (let hop = 0; ; hop++) {
      const url = checkTarget(current, options);
      const agent = hopAgent(options, timings, connectTimeoutMs);
      try {
        const hopStarted = performance.now();
        const response = await request(url, {
          dispatcher: agent,
          method: 'GET',
          signal: controller.signal,
          headersTimeout: headersTimeoutMs,
          bodyTimeout: totalTimeoutMs,
          headers: {
            'user-agent': options.userAgent,
            accept:
              expect === 'html'
                ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'
                : 'text/plain,*/*;q=0.5',
            'accept-language': 'en-GB,en;q=0.8',
            'accept-encoding': 'gzip, br, deflate',
            ...(options.etag ? { 'if-none-match': options.etag } : {}),
            ...(options.lastModified ? { 'if-modified-since': options.lastModified } : {}),
          },
        });
        timings.firstByte = performance.now() - hopStarted;

        const headers = Object.fromEntries(
          Object.entries(response.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(', ') : String(value),
          ]),
        );

        if (REDIRECTS.has(response.statusCode) && headers.location) {
          await response.body.dump();
          if (hop >= maxRedirects)
            throw new FetchError('too-many-redirects', 'The page redirects too many times.');
          redirects.push(current);
          current = new URL(headers.location, current).toString();
          continue;
        }

        if (response.statusCode === 304) {
          await response.body.dump();
          timings.total = performance.now() - started;
          return {
            url: current,
            status: 304,
            headers,
            body: null,
            notModified: true,
            redirects,
            bytes: 0,
            timings,
          };
        }

        const contentType = headers['content-type'] ?? '';
        const ok = response.statusCode >= 200 && response.statusCode < 300;
        if (ok && expect === 'html' && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          await response.body.dump();
          throw new FetchError(
            'not-html',
            `The address serves ${contentType.split(';')[0] || 'something'}, not a web page.`,
          );
        }
        if (Number(headers['content-length'] ?? 0) > maxBytes) {
          await response.body.dump();
          throw new FetchError(
            'too-large',
            `The page is over ${Math.round(maxBytes / 1024 / 1024)} MB.`,
          );
        }

        const downloadStarted = performance.now();
        const bytes = await readCapped(
          response.body,
          headers['content-encoding']?.toLowerCase(),
          maxBytes,
        );
        timings.download = performance.now() - downloadStarted;
        timings.total = performance.now() - started;
        return {
          url: current,
          status: response.statusCode,
          headers,
          body: decode(bytes, contentType),
          notModified: false,
          redirects,
          bytes: bytes.length,
          timings,
        };
      } finally {
        await agent.destroy();
      }
    }
  } catch (error) {
    throw classify(error);
  } finally {
    clearTimeout(deadline);
  }
}
