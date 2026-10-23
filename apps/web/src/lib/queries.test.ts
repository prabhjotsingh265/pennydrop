import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keys, prefetchDashboard } from './queries.ts';

afterEach(() => vi.unstubAllGlobals());

describe('prefetchDashboard', () => {
  async function asked(path: string) {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return Response.json(url.endsWith('/api/watches') ? { watches: [] } : { user: null });
      }),
    );
    const client = new QueryClient();
    prefetchDashboard(client, path);
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    return { urls, client };
  }

  it('asks for who’s signed in and the watchlist on a visit to the watchlist', async () => {
    const { urls, client } = await asked('/app');
    expect(urls).toEqual(['/api/me', '/api/watches']);
    expect(client.getQueryData(keys.watches)).toEqual([]);
  });

  it('asks only who’s signed in for the dashboard’s other pages, and nothing elsewhere', async () => {
    expect((await asked('/app/p/0193')).urls).toEqual(['/api/me']);
    expect((await asked('/admin')).urls).toEqual(['/api/me']);
    expect((await asked('/')).urls).toEqual([]);
    expect((await asked('/apple')).urls).toEqual([]);
  });
});
