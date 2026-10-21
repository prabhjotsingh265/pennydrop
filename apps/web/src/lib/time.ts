import { useEffect, useState } from 'react';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number): string {
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  return `${Math.floor(ms / DAY)} d ago`;
}

/** "every 15 min", "hourly", "every 6 h", "daily". */
export function every(seconds: number): string {
  if (seconds === 3_600) return 'hourly';
  if (seconds === 86_400) return 'daily';
  if (seconds < 3_600) return `every ${seconds / 60} min`;
  return `every ${seconds / 3_600} h`;
}

/** Somewhere to go after signing in: only a path on this site, never another site's address. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

/** The time, updated every so often, for "4 min ago" and the patina of a reading. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
