import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { setConnected } from './live-status.ts';
import { keys } from './queries.ts';

/**
 * Opens the dashboard's live stream: when a check lands or the watchlist
 * changes anywhere, the affected data is fetched again, and the cards roll and
 * reorder by themselves. The browser reconnects on its own if it drops.
 */
export function useLiveUpdates() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setConnected(true));
    source.addEventListener('error', () => setConnected(false));
    source.addEventListener('checked', (event) => {
      const { watchId } = JSON.parse((event as MessageEvent<string>).data) as { watchId: string };
      void queryClient.invalidateQueries({ queryKey: keys.watches, exact: true });
      // The product, and its checks below it.
      void queryClient.invalidateQueries({ queryKey: keys.watch(watchId) });
    });
    source.addEventListener('watches', () => {
      void queryClient.invalidateQueries({ queryKey: keys.watches });
    });
    return () => {
      source.close();
      setConnected(false);
    };
  }, [queryClient]);
}
