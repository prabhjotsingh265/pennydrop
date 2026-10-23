import { Readable } from 'node:stream';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { harness } from '../test/harness.ts';
import { encodingFor } from './compress.ts';

describe('encodingFor', () => {
  it('takes Brotli, then gzip, as the browser accepts them', () => {
    expect(encodingFor('gzip, deflate, br, zstd')).toBe('br');
    expect(encodingFor('gzip')).toBe('gzip');
    expect(encodingFor('BR')).toBe('br');
    expect(encodingFor('br;q=0, gzip;q=0.8')).toBe('gzip');
    expect(encodingFor('gzip;q=0')).toBeNull();
    expect(encodingFor('identity')).toBeNull();
    expect(encodingFor(undefined)).toBeNull();
  });
});

const h = harness();
const big = { items: Array.from({ length: 200 }, (_, i) => ({ i, name: `Product ${i}` })) };
h.app.get('/api/test/big', async () => big);
h.app.get('/api/test/small', async () => ({ ok: true }));
h.app.get('/api/test/csv', async (_request, reply) =>
  reply.type('text/csv').send(big.items.map((item) => `${item.i},${item.name}`).join('\n')),
);
h.app.get('/api/test/stream', async (_request, reply) =>
  reply.type('application/json').send(Readable.from([JSON.stringify(big)])),
);
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});
const get = (url: string, encoding?: string) =>
  h.app.inject({ method: 'GET', url, headers: encoding ? { 'accept-encoding': encoding } : {} });

describe('the API’s answers', () => {
  it('come compressed when large, as the browser accepts, and say so', async () => {
    const br = await get('/api/test/big', 'gzip, br');
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers.vary).toBe('accept-encoding');
    expect(br.rawPayload.length).toBeLessThan(JSON.stringify(big).length / 4);
    expect(JSON.parse(brotliDecompressSync(br.rawPayload).toString())).toEqual(big);

    const gz = await get('/api/test/big', 'gzip');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(gz.rawPayload).toString())).toEqual(big);

    const plain = await get('/api/test/big');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers.vary).toBe('accept-encoding');
    expect(plain.json()).toEqual(big);
  });

  it('compress spreadsheets too, but leave small answers and streams alone', async () => {
    const csv = await get('/api/test/csv', 'br');
    expect(csv.headers['content-encoding']).toBe('br');
    expect(brotliDecompressSync(csv.rawPayload).toString()).toContain('199,Product 199');

    const small = await get('/api/test/small', 'br');
    expect(small.headers['content-encoding']).toBeUndefined();
    expect(small.json()).toEqual({ ok: true });

    const stream = await get('/api/test/stream', 'br');
    expect(stream.headers['content-encoding']).toBeUndefined();
    expect(stream.json()).toEqual(big);
  });
});
