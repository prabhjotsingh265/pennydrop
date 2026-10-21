import { randomUUID } from 'node:crypto';
import {
  QUEUES,
  previewScreenshotKey,
  redisConnection,
  type PreviewJob,
  type PreviewResult,
} from '@pennydrop/queue';
import { Worker } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';
import { PREVIEWS_PER_MINUTE, queuePreviews } from './previews.ts';

const h = harness();
beforeEach(async () => {
  h.wake.mockClear();
  h.previews.clear();
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

const MUG = 'https://fickle.example.com/p/stoneware-mug';

function as(cookie: string) {
  const headers = { cookie, origin: APP_URL };
  return {
    preview: (url: string) =>
      h.app.inject({ method: 'POST', url: '/api/previews', headers, payload: { url } }),
    status: (id: string) => h.app.inject({ method: 'GET', url: `/api/previews/${id}`, headers }),
    screenshot: (id: string) =>
      h.app.inject({ method: 'GET', url: `/api/previews/${id}/screenshot`, headers }),
    add: (payload: Record<string, unknown>) =>
      h.app.inject({ method: 'POST', url: '/api/watches', headers, payload }),
  };
}

/** What the browser fetcher sends back for the mug: a was price, the price, a related product. */
function rendered(extra: Partial<PreviewResult> = {}): PreviewResult {
  const box = { x: 40, y: 200, width: 90, height: 30, currency: 'GBP' };
  return {
    outcome: 'ok',
    detail: 'Read in a browser.',
    url: MUG,
    title: 'Stoneware mug, speckled',
    amount: 3400,
    currency: 'GBP',
    was: 4200,
    inStock: true,
    choices: [
      { ...box, text: '£42.00', amount: 4200, struck: true, best: false },
      { ...box, text: '£34.00', amount: 3400, struck: false, best: true },
      { ...box, text: '£12.50', amount: 1250, struck: false, best: false },
    ],
    selectors: ['.price s', '.price .now', '.related .tile-price'],
    plainHtmlWorks: true,
    screenshot: { width: 1280, height: 1400 },
    timings: { browser: 600, total: 620 },
    ...extra,
  };
}

async function previewed(me: ReturnType<typeof as>, result = rendered(), url = MUG) {
  const { id } = (await me.preview(url)).json();
  h.previews.finish(id, result);
  return id as string;
}

describe('starting a preview', () => {
  it('queues it for the browser with the site’s pace and robots.txt', async () => {
    const me = as(await h.signIn());
    await h.db.site.create({
      data: {
        host: 'fickle.example.com',
        registrable: 'example.com',
        minGapMs: 5_000,
        crawlDelay: 8,
        robotsStatus: 'ok',
        robotsTxt: 'User-agent: *\nAllow: /',
        robotsFetchedAt: new Date(),
      },
    });
    const response = await me.preview('fickle.example.com/p/stoneware-mug?utm_source=x');
    expect(response.statusCode).toBe(202);
    expect(response.json().url).toBe(MUG);
    expect(h.previews.started[0]).toMatchObject({
      url: MUG,
      host: 'fickle.example.com',
      gapMs: 8_000,
      maxInFlight: 1,
      robots: { status: 'ok', body: 'User-agent: *\nAllow: /' },
    });
  });

  it('refuses the same addresses adding does', async () => {
    const response = await as(await h.signIn()).preview('http://10.1.2.3/admin');
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'We can’t check addresses inside private networks.',
      field: 'url',
    });
    expect(h.previews.started).toHaveLength(0);
  });

  it('opens the product you already watch instead', async () => {
    const me = as(await h.signIn());
    const { watch } = (await me.add({ url: MUG })).json();
    expect((await me.preview(MUG)).json()).toEqual({ watchId: watch.id });
    expect(h.previews.started).toHaveLength(0);
  });

  it('says when to try again once there have been too many', async () => {
    h.previews.limited = true;
    const response = await as(await h.signIn()).preview(MUG);
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('42');
  });
});

describe('following a preview', () => {
  it('shows its progress, then the prices to pick from, but never the selectors', async () => {
    const me = as(await h.signIn());
    const { id } = (await me.preview(MUG)).json();
    expect((await me.status(id)).json()).toEqual({ status: 'waiting', step: null, result: null });

    h.previews.finish(id, rendered());
    const done = (await me.status(id)).json();
    expect(done.status).toBe('done');
    expect(done.result.choices).toHaveLength(3);
    expect(done.result).not.toHaveProperty('selectors');

    const image = await me.screenshot(id);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.rawPayload).toEqual(Buffer.from('jpeg'));
  });

  it('is private to the workspace that asked for it', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    const id = await previewed(mine);
    expect((await theirs.status(id)).statusCode).toBe(404);
    expect((await theirs.screenshot(id)).statusCode).toBe(404);
    expect((await theirs.add({ url: MUG, preview: { id, choice: 1 } })).json().field).toBe(
      'preview',
    );
    expect((await mine.status('not-a-preview')).statusCode).toBe(404);
  });
});

describe('adding from a preview', () => {
  it('keeps the automatic pick as it is, and remembers the product’s name', async () => {
    const me = as(await h.signIn());
    const id = await previewed(me);
    const response = await me.add({ url: MUG, preview: { id, choice: 1 } });
    expect(response.statusCode).toBe(201);
    expect(response.json().watch.label).toBe('Stoneware mug, speckled');
    expect(await h.db.recipe.count()).toBe(0);
  });

  it('saves a different pick as the site’s way to read its price, and reads it again now', async () => {
    const me = as(await h.signIn());
    const site = await h.db.site.create({
      data: { host: 'fickle.example.com', registrable: 'example.com' },
    });
    const old = await h.db.recipe.create({
      data: { siteId: site.id, selector: '.price', source: 'auto' },
    });
    const other = await h.db.target.create({
      data: {
        siteId: site.id,
        url: 'https://fickle.example.com/p/teapot',
        canonicalUrl: 'https://fickle.example.com/p/teapot',
        etag: '"abc"',
      },
    });
    const id = await previewed(me);

    await me.add({ url: MUG, preview: { id, choice: 2 } });
    const recipes = await h.db.recipe.findMany({ orderBy: { activeFrom: 'asc' } });
    expect(recipes.map((r) => [r.selector, r.source, r.retiredAt !== null])).toEqual([
      ['.price', 'auto', true],
      ['.related .tile-price', 'user', false],
    ]);
    expect(recipes[0]!.id).toBe(old.id);
    // Every page on the site is asked for in full next time, not "has it changed?".
    expect((await h.db.target.findUniqueOrThrow({ where: { id: other.id } })).etag).toBeNull();
    expect(h.wake).toHaveBeenCalled();
  });

  it('remembers that the site needs a browser when the page as served had no price', async () => {
    const me = as(await h.signIn());
    const id = await previewed(me, rendered({ plainHtmlWorks: false }));
    await me.add({ url: MUG, preview: { id, choice: 1 } });
    const site = await h.db.site.findUniqueOrThrow({ where: { host: 'fickle.example.com' } });
    expect(site.needsBrowser).toBe(true);
  });

  it('saves the address the page ended up at', async () => {
    const me = as(await h.signIn());
    const landed = 'https://fickle.example.com/products/stoneware-mug';
    const id = await previewed(me, rendered({ url: landed }));
    const { watch } = (await me.add({ url: MUG, preview: { id, choice: 1 } })).json();
    expect(watch.url).toBe(landed);
  });

  it('refuses a preview of another address, an unknown preview and a choice that isn’t there', async () => {
    const me = as(await h.signIn());
    const id = await previewed(me);
    const attempts = [
      { url: 'https://fickle.example.com/p/teapot', preview: { id, choice: 1 } },
      { url: MUG, preview: { id: randomUUID(), choice: 1 } },
      { url: MUG, preview: { id, choice: 7 } },
    ];
    for (const payload of attempts) {
      const response = await me.add(payload);
      expect(response.statusCode).toBe(422);
      expect(response.json().field).toBe('preview');
    }
    expect(await h.db.watch.count()).toBe(0);
  });
});

describe('previews through the queue', () => {
  const connection = redisConnection();
  const prefix = `test-${randomUUID()}`;
  const previews = queuePreviews(connection, prefix);
  afterAll(async () => {
    await previews.close();
    const keys = [
      ...(await connection.keys(`${prefix}:*`)),
      ...(await connection.keys('pennydrop:preview-rate:test-*')),
    ];
    if (keys.length) await connection.del(...keys);
    await connection.quit();
  });

  const job = (workspaceId: string): PreviewJob => ({
    url: MUG,
    host: 'fickle.example.com',
    workspaceId,
    robots: null,
    gapMs: 0,
    maxInFlight: 1,
  });

  it('hands the fetcher’s result back to the workspace that asked, and no other', async () => {
    const workspace = `test-${randomUUID()}`;
    const started = await previews.start(job(workspace));
    if (!('id' in started)) throw new Error('rate limited');
    expect(await previews.get(started.id, workspace)).toMatchObject({ status: 'waiting' });

    const worker = new Worker<PreviewJob, PreviewResult>(
      QUEUES.preview,
      async (j) => {
        await j.updateProgress({ step: 'opening' });
        await connection.set(previewScreenshotKey(j.id!), Buffer.from('jpeg'), 'EX', 60);
        return rendered();
      },
      { connection, prefix },
    );
    let state = await previews.get(started.id, workspace);
    for (let i = 0; i < 50 && state?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      state = await previews.get(started.id, workspace);
    }
    await worker.close();

    expect(state).toMatchObject({ url: MUG, status: 'done', step: 'opening' });
    expect(state?.result?.amount).toBe(3400);
    expect(await previews.screenshot(started.id, workspace)).toEqual(Buffer.from('jpeg'));
    expect(await previews.get(started.id, 'someone-else')).toBeNull();
    expect(await previews.screenshot(started.id, 'someone-else')).toBeNull();
    await connection.del(previewScreenshotKey(started.id));
  });

  it(`allows ${PREVIEWS_PER_MINUTE} a minute per workspace`, async () => {
    const workspace = `test-${randomUUID()}`;
    const results = [];
    for (let i = 0; i <= PREVIEWS_PER_MINUTE; i++)
      results.push(await previews.start(job(workspace)));
    expect(results.filter((r) => 'id' in r)).toHaveLength(PREVIEWS_PER_MINUTE);
    const last = results.at(-1)!;
    expect('retryAfter' in last && last.retryAfter).toBeGreaterThan(50);
    // Someone else's previews aren't held up.
    expect('id' in (await previews.start(job(`test-${randomUUID()}`)))).toBe(true);
  });
});
