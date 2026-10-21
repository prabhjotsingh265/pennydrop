import type {
  CheckSummary,
  Me,
  PreviewView,
  UpdateWatchInput,
  WatchDetail,
  WatchSummary,
} from '@pennydrop/domain';
import {
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, api } from './api.ts';

export const keys = {
  me: ['me'] as const,
  watches: ['watches'] as const,
  watch: (id: string) => ['watches', id] as const,
  checks: (id: string) => ['watches', id, 'checks'] as const,
  preview: (id: string) => ['previews', id] as const,
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
export const fetchMe = () =>
  api<Me>('/api/me').catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  });

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 60_000 });
}

export function useWatches() {
  return useQuery({
    queryKey: keys.watches,
    queryFn: ({ signal }) =>
      api<{ watches: WatchSummary[] }>('/api/watches', { signal }).then((data) => data.watches),
    refetchInterval: 30_000,
  });
}

/** One product. `eager`: a check was just asked for, so look every couple of seconds. */
export function useWatch(id: string, eager = false) {
  return useQuery({
    queryKey: keys.watch(id),
    queryFn: ({ signal }) => api<WatchDetail>(`/api/watches/${id}`, { signal }),
    refetchInterval: eager ? 2_000 : 30_000,
  });
}

export function useChecks(id: string, eager = false) {
  return useQuery({
    queryKey: keys.checks(id),
    queryFn: ({ signal }) =>
      api<{ checks: CheckSummary[] }>(`/api/watches/${id}/checks`, { signal }).then(
        (data) => data.checks,
      ),
    refetchInterval: eager ? 2_000 : 30_000,
  });
}

/** Changing, checking and removing one product, keeping the cached copies in step. */
export function useWatchActions(id: string) {
  const queryClient = useQueryClient();
  const refreshList = () => queryClient.invalidateQueries({ queryKey: keys.watches, exact: true });

  const update = useMutation({
    mutationFn: (changes: UpdateWatchInput) =>
      api<{ watch: WatchSummary }>(`/api/watches/${id}`, { method: 'PATCH', body: changes }),
    onSuccess: ({ watch }) => {
      // The answer carries 30 days of history; the product page keeps all of it.
      queryClient.setQueryData<WatchDetail>(
        keys.watch(id),
        (old) => old && { ...old, watch: { ...watch, history: old.watch.history } },
      );
      void refreshList();
    },
  });
  const checkNow = useMutation({
    mutationFn: () => api(`/api/watches/${id}/check`, { method: 'POST' }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/watches/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: keys.watch(id) });
      void refreshList();
    },
  });
  return { update, checkNow, remove };
}

/** A preview, asked about twice a second until it's finished. */
export function usePreview(id: string) {
  return useQuery({
    queryKey: keys.preview(id),
    queryFn: ({ signal }) => api<PreviewView>(`/api/previews/${id}`, { signal }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : 500;
    },
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
