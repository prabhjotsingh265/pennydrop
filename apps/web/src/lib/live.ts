import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { alertArrived, setConnected } from './live-status.ts';
import { keys } from './queries.ts';

/**
 * Opens the dashboard's live stream: when a check lands, the watchlist changes
 * or an alert fires, the affected data is fetched again, and the cards roll and
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
      // The product, and its checks below it; then the Sites and Checks pages, if open.
      void queryClient.invalidateQueries({ queryKey: keys.watch(watchId) });
      void queryClient.invalidateQueries({ queryKey: keys.sites });
      void queryClient.invalidateQueries({ queryKey: ['checks'] });
      void queryClient.invalidateQueries({ queryKey: keys.groups });
    });
    source.addEventListener('watches', () => {
      void queryClient.invalidateQueries({ queryKey: keys.watches });
      void queryClient.invalidateQueries({ queryKey: keys.groups });
    });
    source.addEventListener('alert', () => {
      // The inbox and the bell; and the rules, as one that fired now waits to re-arm.
      void queryClient.invalidateQueries({ queryKey: keys.alerts });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'watches' && query.queryKey[2] === 'rules',
      });
      alertArrived();
    });
    return () => {
      source.close();
      setConnected(false);
    };
  }, [queryClient]);
}
