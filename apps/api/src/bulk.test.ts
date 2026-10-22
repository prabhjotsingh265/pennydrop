import type { PreviewResult } from '@pennydrop/queue';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

const h = harness();
beforeEach(async () => {
  h.wake.mockClear();
  h.published.length = 0;
  h.previews.clear();
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

const post = (cookie: string, url: string, payload: unknown) =>
  h.app.inject({
    method: 'POST',
    url,
    headers: { cookie, origin: APP_URL },
    payload: payload as object,
  });

describe('POST /api/watches/bulk', () => {
  it('adds each line like a single address and says how each one went', async () => {
    const me = await h.signIn();
    const response = await post(me, '/api/watches/bulk', {
      items: [
        { url: 'https://fickle.example.com/p/mug', targetPrice: 3000, label: 'Mug' },
        { url: 'http://192.168.1.4/p/kettle' },
        { url: 'fickle.example.com/p/mug?utm_source=list' },
        { url: 'not an address' },
        { url: 'https://slowpoke.example.com/p/lamp' },
      ],
    });
    expect(response.statusCode).toBe(200);
    const { results } = response.json();
    expect(
      results.map((r: { ok: boolean; created?: boolean; error?: string }) =>
        r.ok ? (r.created ? 'added' : 'already') : r.error,
      ),
    ).toEqual([
      'added',
      'We can’t check addresses inside private networks.',
      'already',
      'That doesn’t look like a product page address.',
      'added',
    ]);
    // The duplicate line is the same product as the first.
    expect(results[2].watchId).toBe(results[0].watchId);
    const mug = await h.db.watch.findUniqueOrThrow({ where: { id: results[0].watchId } });
    expect(mug).toMatchObject({ label: 'Mug', targetPrice: 3000n });
    // One wake-up and one announcement for the whole batch.
    expect(h.wake).toHaveBeenCalledOnce();
    expect(h.published).toHaveLength(1);
  });

  it('stops at the workspace’s limit, line by line', async () => {
    const me = await h.signIn();
    await h.db.workspace.updateMany({ data: { maxWatches: 2 } });
    const { results } = (
      await post(me, '/api/watches/bulk', {
        items: ['a', 'b', 'c'].map((p) => ({ url: `https://fickle.example.com/p/${p}` })),
      })
    ).json();
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, false]);
    expect(results[2].error).toBe('This workspace can watch up to 2 products.');
  });

  it('takes at most 50 lines', async () => {
    const me = await h.signIn();
    const items = Array.from({ length: 51 }, (_, i) => ({
      url: `https://fickle.example.com/p/${i}`,
    }));
    expect((await post(me, '/api/watches/bulk', { items })).statusCode).toBe(422);
  });
});

describe('picking the price again', () => {
  const MUG = 'https://fickle.example.com/p/mug';
  const result = (): PreviewResult => ({
    outcome: 'price_not_found',
    detail: 'No price was found, even in a browser.',
    url: MUG,
    title: 'Mug',
    amount: null,
    currency: 'GBP',
    was: null,
    inStock: null,
    choices: [
      {
        text: '£34.00',
        amount: 3400,
        currency: 'GBP',
        x: 10,
        y: 10,
        width: 50,
        height: 20,
        struck: false,
        best: false,
      },
      {
        text: '£12.50',
        amount: 1250,
        currency: 'GBP',
        x: 10,
        y: 900,
        width: 50,
        height: 14,
        struck: false,
        best: false,
      },
    ],
    selectors: ['.hero .amount', '.related .amount'],
    // Nothing read a price, so nobody knows yet whether plain HTTP would do.
    plainHtmlWorks: null,
    screenshot: { width: 1280, height: 1200 },
    timings: {},
  });

  it('previews a product already on the watchlist, and saves the price picked', async () => {
    const me = await h.signIn();
    const { watch } = (await post(me, '/api/watches', { url: MUG })).json();
    h.wake.mockClear();

    // Without "repick", previewing a watched product just opens it.
    expect((await post(me, '/api/previews', { url: MUG })).json()).toEqual({ watchId: watch.id });
    const started = await post(me, '/api/previews', { url: MUG, repick: true });
    expect(started.statusCode).toBe(202);
    const { id } = started.json();
    h.previews.finish(id, result());

    const picked = await post(me, `/api/watches/${watch.id}/pick`, { preview: { id, choice: 0 } });
    expect(picked.statusCode).toBe(200);
    const recipes = await h.db.recipe.findMany({ where: { retiredAt: null } });
    expect(recipes.map((r) => [r.selector, r.source])).toEqual([['.hero .amount', 'user']]);
    // Left for the next check to find out: plain HTTP first, then a browser if need be.
    const site = await h.db.site.findUniqueOrThrow({ where: { host: 'fickle.example.com' } });
    expect(site.needsBrowser).toBe(false);
    expect(h.wake).toHaveBeenCalledOnce();
  });

  it('refuses a preview of another page, and another workspace’s product', async () => {
    const me = await h.signIn('a@example.com');
    const other = await h.signIn('b@example.com');
    const { watch } = (await post(me, '/api/watches', { url: MUG })).json();
    const { id } = (
      await post(me, '/api/previews', { url: 'https://fickle.example.com/p/lamp' })
    ).json();
    h.previews.finish(id, { ...result(), url: 'https://fickle.example.com/p/lamp' });

    const wrong = await post(me, `/api/watches/${watch.id}/pick`, { preview: { id, choice: 0 } });
    expect(wrong.json()).toMatchObject({
      field: 'preview',
      error: 'That preview was for a different address.',
    });
    const theirs = await post(other, `/api/watches/${watch.id}/pick`, {
      preview: { id, choice: 0 },
    });
    expect(theirs.statusCode).toBe(404);
  });
});
