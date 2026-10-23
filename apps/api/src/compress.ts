import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { FastifyReply, FastifyRequest } from 'fastify';

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);
/** Smaller answers gain too little to be worth the work. */
const MIN_BYTES = 1024;
/** JSON and CSV: the API's own answers. Pages and their files come compressed already. */
const COMPRESSIBLE = /^(application\/json|text\/csv)\b/;

/** The encoding to answer in, from the browser's Accept-Encoding: Brotli, then gzip, or none. */
export function encodingFor(accept: string | undefined): 'br' | 'gzip' | null {
  const accepted = new Set(
    (accept ?? '')
      .split(',')
      .map((part) => part.trim().split(';'))
      .filter(([, ...params]) => !params.some((param) => /^\s*q=0(\.0*)?\s*$/.test(param)))
      .map(([name]) => name!.trim().toLowerCase()),
  );
  if (accepted.has('br')) return 'br';
  if (accepted.has('gzip')) return 'gzip';
  return null;
}

/**
 * An onSend hook: the API's larger answers compressed, as the browser accepts. A watchlist of
 * 100 products is 158 KB of JSON and 14 KB gzipped, most of a phone's wait on a slow line.
 * Streams (live updates, the app's files) pass through as they are.
 */
export async function compressAnswer(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
  if (request.method === 'HEAD' || reply.hasHeader('content-encoding')) return payload;
  if (!COMPRESSIBLE.test(String(reply.getHeader('content-type') ?? ''))) return payload;
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  if (body.length < MIN_BYTES) return payload;
  const vary = String(reply.getHeader('vary') ?? '');
  if (!/\baccept-encoding\b/i.test(vary)) {
    reply.header('vary', vary ? `${vary}, accept-encoding` : 'accept-encoding');
  }
  const encoding = encodingFor(request.headers['accept-encoding']);
  if (!encoding) return payload;
  reply.header('content-encoding', encoding);
  reply.removeHeader('content-length');
  return encoding === 'br'
    ? brotli(body, {
        params: {
          // Quality 5: most of the saving, at a few milliseconds for a large answer.
          [constants.BROTLI_PARAM_QUALITY]: 5,
          [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        },
      })
    : gzipped(body, { level: 6 });
}
