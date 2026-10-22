import { useSyncExternalStore } from 'react';

// Whether the live stream is open, shared by everything that asks.
let connected = false;
const listeners = new Set<() => void>();

export function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
}

/** True while updates arrive by themselves; then polling can slow right down. */
export function useLiveStatus(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => connected,
    () => false,
  );
}

/** How often to ask for fresh data: rarely while live, every 30 s otherwise. */
export function usePollInterval(): number {
  return useLiveStatus() ? 5 * 60_000 : 30_000;
}

// Alerts that arrived while the dashboard was open: each one drops a penny into the bell.
let arrivals = 0;
const arrivalListeners = new Set<() => void>();

export function alertArrived() {
  arrivals++;
  for (const listener of arrivalListeners) listener();
}

/** Counts up once per alert arriving live; 0 until the first. */
export function useArrivals(): number {
  return useSyncExternalStore(
    (onChange) => {
      arrivalListeners.add(onChange);
      return () => arrivalListeners.delete(onChange);
    },
    () => arrivals,
    () => 0,
  );
}
