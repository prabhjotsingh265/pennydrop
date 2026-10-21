import type { CheckSummary, Me, WatchDetail, WatchSummary } from '@pennydrop/domain';
import { QueryCache, QueryClient, useQuery } from '@tanstack/react-query';
import { ApiError, api } from './api.ts';

export const keys = {
  me: ['me'] as const,
  watches: ['watches'] as const,
  watch: (id: string) => ['watches', id] as const,
  checks: (id: string) => ['watches', id, 'checks'] as const,
};

export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // A session that ran out mid-visit: forget who was signed in, and the guard sends them to sign in.
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) client.setQueryData(keys.me, null);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // A 4xx won't change by asking again.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  });
  return client;
}

/** Who's signed in: null when nobody is. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () =>
      api<Me>('/api/me').catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }),
    staleTime: 60_000,
  });
}

export function useWatches() {
  return useQuery({
    queryKey: keys.watches,
    queryFn: ({ signal }) =>
      api<{ watches: WatchSummary[] }>('/api/watches', { signal }).then((data) => data.watches),
    refetchInterval: 30_000,
  });
}

export function useWatch(id: string) {
  return useQuery({
    queryKey: keys.watch(id),
    queryFn: ({ signal }) => api<WatchDetail>(`/api/watches/${id}`, { signal }),
    refetchInterval: 30_000,
  });
}

export function useChecks(id: string) {
  return useQuery({
    queryKey: keys.checks(id),
    queryFn: ({ signal }) =>
      api<{ checks: CheckSummary[] }>(`/api/watches/${id}/checks`, { signal }).then(
        (data) => data.checks,
      ),
    refetchInterval: 30_000,
  });
}
