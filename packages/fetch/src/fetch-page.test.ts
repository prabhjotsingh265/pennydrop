import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchPage, type FetchPageOptions } from './fetch-page.ts';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

async function serve(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

const UA = 'PennydropBot/test';
// Only the test servers may be private; everything else gets the real rules.
const local: FetchPageOptions = { userAgent: UA, allowPrivate: (host) => host === 'localhost' };
const strict: FetchPageOptions = { userAgent: UA };

const html =
  (body: string, type = 'text/html; charset=utf-8'): RequestListener =>
  (_req, res) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'no error';
}

describe('refusing to be pointed inside a network', () => {
  it.each([
    'http://127.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
  ])('refuses %s', async (address) => {
    expect(await failure(fetchPage(address, strict))).toBe('blocked-address');
  });

  it('refuses a name that resolves to a private address', async () => {
    const resolve = async () => [{ address: '10.0.0.5', family: 4 }];
    expect(await failure(fetchPage('http://evil.test/', { ...strict, resolve }))).toBe(
      'blocked-address',
    );
  });

  it('refuses a name with any private address among its answers', async () => {
    const resolve = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    expect(await failure(fetchPage('http://mixed.test/', { ...strict, resolve }))).toBe(
      'blocked-address',
    );
  });

  it('checks every redirect again', async () => {
    const start = await serve((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    });
    expect(await failure(fetchPage(start, local))).toBe('blocked-address');
  });

  it('refuses other schemes and ports', async () => {
    expect(await failure(fetchPage('ftp://example.com/', strict))).toBe('not-http');
    expect(await failure(fetchPage('file:///etc/passwd', strict))).toBe('not-http');
    expect(await failure(fetchPage('http://example.com:22/', strict))).toBe('blocked-port');
  });
});

describe('fetching a page', () => {
  it('returns the page, its status and how long each step took', async () => {
    let agent = '';
    const url = await serve((req, res) => {
      agent = req.headers['user-agent'] ?? '';
      html('<h1>Mug</h1><p>£31.99</p>')(req, res);
    });
    const page = await fetchPage(`${url}/p/mug`, local);
    expect(page).toMatchObject({
      status: 200,
      body: '<h1>Mug</h1><p>£31.99</p>',
      notModified: false,
    });
    expect(agent).toBe(UA);
    expect(page.timings.firstByte).toBeGreaterThan(0);
    expect(page.timings.total).toBeGreaterThanOrEqual(page.timings.firstByte);
  });

  it('decodes the character set the page declares', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=windows-1252' });
      res.end(Buffer.from([0x3c, 0x70, 0x3e, 0xa3, 0x33, 0x31])); // <p>£31
    });
    expect((await fetchPage(url, local)).body).toBe('<p>£31');
  });

  it('unpacks compressed pages', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(gzipSync('<p>£31.99</p>'));
    });
    expect((await fetchPage(url, local)).body).toBe('<p>£31.99</p>');
  });

  it('stops a small download that unpacks into gigabytes', async () => {
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(100_000);
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(bomb);
    });
    expect(await failure(fetchPage(url, local))).toBe('too-large');
  });

  it('refuses what isn’t a web page', async () => {
    const url = await serve(html('PNG', 'image/png'));
    expect(await failure(fetchPage(url, local))).toBe('not-html');
    const text = await serve(html('User-agent: *', 'text/plain'));
    expect((await fetchPage(text, { ...local, expect: 'text' })).body).toBe('User-agent: *');
  });

  it('asks whether the page changed, and accepts "no"', async () => {
    const url = await serve((req, res) => {
      if (req.headers['if-none-match'] === '"v1"') return void res.writeHead(304).end();
      res.writeHead(200, { 'content-type': 'text/html', etag: '"v1"' }).end('<p>£1</p>');
    });
    const first = await fetchPage(url, local);
    const again = await fetchPage(url, { ...local, etag: first.headers.etag });
    expect(again).toMatchObject({ status: 304, notModified: true, body: null });
  });

  it('returns error statuses for the caller to judge', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/html', 'retry-after': '30' }).end('Down');
    });
    expect(await fetchPage(url, local)).toMatchObject({ status: 503, body: 'Down' });
  });

  it('gives up on a site that never answers', async () => {
    const url = await serve(() => {
      // Accepts the connection, never replies.
    });
    const started = Date.now();
    expect(await failure(fetchPage(url, { ...local, headersTimeoutMs: 300 }))).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('follows a few redirects, and no more', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/old') return void res.writeHead(301, { location: '/new' }).end();
      if (req.url === '/loop') return void res.writeHead(302, { location: '/loop' }).end();
      html('<p>£2</p>')(req, res);
    });
    const page = await fetchPage(`${url}/old`, local);
    expect(page).toMatchObject({ url: `${url}/new`, redirects: [`${url}/old`] });
    expect(await failure(fetchPage(`${url}/loop`, local))).toBe('too-many-redirects');
  });
});
