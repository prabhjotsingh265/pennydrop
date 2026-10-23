import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { harness } from '../test/harness.ts';
import { contentSecurityPolicy } from './app.ts';

// A built app, as Vite writes it: index.html, and hashed files under assets/; and the public
// pages rendered ahead of time, with a placeholder for the server's address.
const dist = mkdtempSync(join(tmpdir(), 'pennydrop-web-'));
mkdirSync(join(dist, 'assets'));
mkdirSync(join(dist, 'pages'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Pennydrop</title>');
const rendered = (title: string) =>
  `<!doctype html><title>${title}</title><link rel="canonical" href="__APP_URL__/x" />` +
  `<div id="root"><h1 style="color:red">${title}</h1></div>`;
writeFileSync(join(dist, 'pages', 'index.html'), rendered('Know when the penny drops'));
writeFileSync(join(dist, 'pages', 'bot.html'), rendered('Our crawler'));
writeFileSync(join(dist, 'assets', 'index-a1b2c3.js'), 'console.log(1)');
writeFileSync(join(dist, 'robots.txt'), 'User-agent: *');
// And compressed, as the build writes them.
for (const file of ['index.html', 'assets/index-a1b2c3.js']) {
  const body = readFileSync(join(dist, file));
  writeFileSync(join(dist, `${file}.br`), brotliCompressSync(body));
  writeFileSync(join(dist, `${file}.gz`), gzipSync(body));
}

const h = harness({ webDist: dist });
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});
const get = (url: string) => h.app.inject({ method: 'GET', url });

describe('the built app, from the API', () => {
  it('answers every page of the app with index.html, asked for afresh, and kept out of search', async () => {
    for (const url of ['/app', '/app/p/0193?x=1', '/demo', '/signin']) {
      const page = await get(url);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>Pennydrop</title>');
      expect(page.headers['cache-control']).toBe('no-cache');
      expect(page.headers['x-robots-tag']).toBe('noindex');
      expect(page.headers['content-security-policy']).toBe(contentSecurityPolicy(false));
    }
    // Uptime monitors ask with HEAD.
    expect((await h.app.inject({ method: 'HEAD', url: '/' })).statusCode).toBe(200);
  });

  it('answers the public pages rendered, with the server’s own address, for search and previews', async () => {
    for (const [url, title] of [
      ['/', 'Know when the penny drops'],
      ['/bot', 'Our crawler'],
      ['/bot/', 'Our crawler'],
      ['/bot?from=log', 'Our crawler'],
    ] as const) {
      const page = await get(url);
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(page.headers['cache-control']).toBe('no-cache');
      expect(page.headers['x-robots-tag']).toBeUndefined();
      expect(page.body).toContain(`<h1 style="color:red">${title}</h1>`);
      expect(page.body).toContain('href="http://localhost:3000/x"');
      // React's style attributes in the rendered page are allowed; nothing else is loosened.
      const policy = page.headers['content-security-policy'];
      expect(policy).toBe(contentSecurityPolicy(false, { styleAttributes: true }));
      expect(policy).toContain("style-src-attr 'unsafe-inline'");
      expect(policy).toContain("script-src 'self';");
    }
    // Never as the build left them, placeholder and all.
    expect((await get('/pages/index.html')).statusCode).toBe(404);
  });

  it('sends the compressed copy the browser takes, pages included', async () => {
    const as = (url: string, encoding?: string) =>
      h.app.inject({
        method: 'GET',
        url,
        headers: encoding ? { 'accept-encoding': encoding } : {},
      });
    const br = await as('/assets/index-a1b2c3.js', 'gzip, deflate, br');
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers.vary).toContain('accept-encoding');
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(brotliDecompressSync(br.rawPayload).toString()).toBe('console.log(1)');
    const gz = await as('/assets/index-a1b2c3.js', 'gzip');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.rawPayload).toString()).toBe('console.log(1)');
    const plain = await as('/assets/index-a1b2c3.js');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.body).toBe('console.log(1)');

    const page = await as('/app/settings', 'br');
    expect(page.headers['content-encoding']).toBe('br');
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(brotliDecompressSync(page.rawPayload).toString()).toContain('<title>Pennydrop</title>');
  });

  it('answers a missing file with a 404, not the page', async () => {
    for (const url of ['/assets/index-old.js', '/favicon.ico', '/app/missing.png?v=2']) {
      const missing = await get(url);
      expect(missing.statusCode).toBe(404);
      expect(missing.body).not.toContain('<title>');
    }
  });

  it('keeps hashed files for a year, and other files fresh', async () => {
    const script = await get('/assets/index-a1b2c3.js');
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await get('/robots.txt')).headers['cache-control']).toBe('no-cache');
  });

  it('leaves the API’s own not-found answers as they are', async () => {
    const missing = await get('/api/no-such-thing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'Not found.' });
    expect(missing.headers['cache-control']).toBe('no-store');
    expect((await h.app.inject({ method: 'POST', url: '/somewhere' })).statusCode).toBe(404);
  });

  it('sends the strict content security policy with the app’s pages and its files', async () => {
    expect((await get('/app')).headers['content-security-policy']).toBe(
      contentSecurityPolicy(false),
    );
    expect((await get('/robots.txt')).headers['content-security-policy']).toBe(
      contentSecurityPolicy(false),
    );
  });
});

describe('contentSecurityPolicy', () => {
  it('allows only this origin, and upgrades requests once served over HTTPS', () => {
    const policy = contentSecurityPolicy(false);
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(contentSecurityPolicy(true)).toContain('upgrade-insecure-requests');
  });
});
