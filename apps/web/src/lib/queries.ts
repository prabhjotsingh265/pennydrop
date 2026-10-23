import type {
  AlertSummary,
  ChannelSummary,
  CheckFeed,
  DemoState,
  GroupDetail,
  GroupSummary,
  CheckSummary,
  Me,
  PreviewView,
  RuleSummary,
  SiteSummary,
  UpdateWatchInput,
  WatchDetail,
  WatchSummary,
} from '@pennydrop/domain';
import {
  QueryCache,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, api } from './api.ts';
import { usePollInterval } from './live-status.ts';

export const keys = {
  me: ['me'] as const,
  watches: ['watches'] as const,
  watch: (id: string) => ['watches', id] as const,
  checks: (id: string) => ['watches', id, 'checks'] as const,
  preview: (id: string) => ['previews', id] as const,
  sites: ['sites'] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['groups', id] as const,
  feed: (show: 'all' | 'problems') => ['checks', show] as const,
  rules: (id: string) => ['watches', id, 'rules'] as const,
  channels: ['channels'] as const,
  alerts: ['alerts'] as const,
  unread: ['alerts', 'unread'] as const,
  demo: ['demo'] as const,
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

const fetchWatches = ({ signal }: { signal?: AbortSignal }) =>
  api<{ watches: WatchSummary[] }>('/api/watches', { signal }).then((data) => data.watches);

export function useWatches() {
  const poll = usePollInterval();
  return useQuery({ queryKey: keys.watches, queryFn: fetchWatches, refetchInterval: poll });
}

/**
 * Opening the dashboard straight from an address: who's signed in, and the watchlist, are
 * asked for at once, while the page's own code is still on its way, not after it arrives.
 */
export function prefetchDashboard(client: QueryClient, path: string) {
  if (!/^\/(app|admin)(\/|$)/.test(path)) return;
  void client.prefetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 60_000 });
  if (/^\/app\/?$/.test(path)) {
    void client.prefetchQuery({ queryKey: keys.watches, queryFn: fetchWatches });
  }
}

/** One product. `eager`: a check was just asked for, so look every couple of seconds. */
export function useWatch(id: string, eager = false) {
  const poll = usePollInterval();
  return useQuery({
    queryKey: keys.watch(id),
    queryFn: ({ signal }) => api<WatchDetail>(`/api/watches/${id}`, { signal }),
    refetchInterval: eager ? 2_000 : poll,
  });
}

export function useChecks(id: string, eager = false) {
  const poll = usePollInterval();
  return useQuery({
    queryKey: keys.checks(id),
    queryFn: ({ signal }) =>
      api<{ checks: CheckSummary[] }>(`/api/watches/${id}/checks`, { signal }).then(
        (data) => data.checks,
      ),
    refetchInterval: eager ? 2_000 : poll,
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
      // A new target turns its rule on; a listing no longer yours loses "undercut".
      void queryClient.invalidateQueries({ queryKey: keys.rules(id) });
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

/** The shops this workspace watches something on, and how checking them is going. */
export function useSites() {
  const poll = usePollInterval();
  return useQuery({
    queryKey: keys.sites,
    queryFn: ({ signal }) =>
      api<{ sites: SiteSummary[] }>('/api/sites', { signal }).then((data) => data.sites),
    refetchInterval: poll,
  });
}

/** Every check across the workspace, newest first, a page at a time. */
export function useCheckFeed(show: 'all' | 'problems') {
  const poll = usePollInterval();
  return useInfiniteQuery({
    queryKey: keys.feed(show),
    queryFn: ({ pageParam, signal }) =>
      api<CheckFeed>(
        `/api/checks?show=${show}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    refetchInterval: poll,
  });
}

export function useGroups() {
  return useQuery({
    queryKey: keys.groups,
    queryFn: ({ signal }) =>
      api<{ groups: GroupSummary[] }>('/api/groups', { signal }).then((data) => data.groups),
  });
}

export function useGroup(id: string) {
  const poll = usePollInterval();
  return useQuery({
    queryKey: keys.group(id),
    queryFn: ({ signal }) => api<GroupDetail>(`/api/groups/${id}`, { signal }),
    refetchInterval: poll,
  });
}

/** Where alerts go. */
export function useChannels() {
  return useQuery({
    queryKey: keys.channels,
    queryFn: ({ signal }) =>
      api<{ channels: ChannelSummary[] }>('/api/channels', { signal }).then(
        (data) => data.channels,
      ),
  });
}

/** The alert rules on one product. */
export function useRules(id: string) {
  return useQuery({
    queryKey: keys.rules(id),
    queryFn: ({ signal }) =>
      api<{ rules: RuleSummary[] }>(`/api/watches/${id}/rules`, { signal }).then(
        (data) => data.rules,
      ),
  });
}

/** The inbox, newest first, a page at a time. */
export function useAlerts() {
  const poll = usePollInterval();
  return useInfiniteQuery({
    queryKey: [...keys.alerts, 'list'],
    queryFn: ({ pageParam, signal }) =>
      api<{ alerts: AlertSummary[]; next: string | null }>(
        `/api/alerts${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    refetchInterval: poll,
  });
}

/** How many alerts nobody has looked at yet, for the bell. */
export function useUnread() {
  const poll = usePollInterval();
  return useQuery({
    queryKey: keys.unread,
    queryFn: ({ signal }) =>
      api<{ count: number }>('/api/alerts/unread', { signal }).then((data) => data.count),
    refetchInterval: poll,
  });
}

/** A demo workspace's time left and its own shop; nothing for an ordinary workspace. */
export function useDemo() {
  const isDemo = useMe().data?.workspace.isDemo ?? false;
  return useQuery({
    queryKey: keys.demo,
    queryFn: ({ signal }) => api<DemoState>('/api/demo', { signal }),
    enabled: isDemo,
  });
}
