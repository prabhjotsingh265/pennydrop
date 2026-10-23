import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { harness } from '../test/harness.ts';
import { contentSecurityPolicy } from './app.ts';

// A built app, as Vite writes it: index.html, and hashed files under assets/.
const dist = mkdtempSync(join(tmpdir(), 'pennydrop-web-'));
mkdirSync(join(dist, 'assets'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Pennydrop</title>');
writeFileSync(join(dist, 'assets', 'index-a1b2c3.js'), 'console.log(1)');
writeFileSync(join(dist, 'robots.txt'), 'User-agent: *');

const h = harness({ webDist: dist });
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});
const get = (url: string) => h.app.inject({ method: 'GET', url });

describe('the built app, from the API', () => {
  it('answers every page of the app with index.html, asked for afresh each time', async () => {
    for (const url of ['/', '/app', '/app/p/0193?x=1', '/demo']) {
      const page = await get(url);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>Pennydrop</title>');
      expect(page.headers['cache-control']).toBe('no-cache');
    }
    // Uptime monitors ask with HEAD.
    expect((await h.app.inject({ method: 'HEAD', url: '/' })).statusCode).toBe(200);
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

  it('sends the content security policy with every page', async () => {
    expect((await get('/')).headers['content-security-policy']).toBe(contentSecurityPolicy(false));
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
