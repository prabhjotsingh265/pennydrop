const DAY_MS = 86_400_000;

/** Minutes after midnight, at an instant, in a time zone. */
export function localMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return value('hour') * 60 + value('minute');
}

/** How far a zone is ahead of UTC at an instant, in minutes ("GMT+05:30" is 330). */
function offsetMinutes(at: number, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** Quiet hours, which may run past midnight (22:00 to 07:00). Equal ends mean none. */
export function inWindow(at: number, timeZone: string, from: number, until: number): boolean {
  if (from === until) return false;
  const now = localMinutes(at, timeZone);
  return from < until ? now >= from && now < until : now >= from || now < until;
}

/**
 * The next instant after `at` when the clock in `timeZone` reads `minutes`
 * past midnight: when quiet hours end, or when the daily digest goes. The
 * zone's offset is read at the answer itself, so a clock change in between
 * doesn't put it an hour out.
 */
export function nextLocalTime(at: number, timeZone: string, minutes: number): number {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(at)
    .split('-')
    .map(Number) as [number, number, number];
  const onDay = (dayOffset: number) => {
    const wall = Date.UTC(ymd[0], ymd[1] - 1, ymd[2] + dayOffset, 0, minutes);
    const guess = wall - offsetMinutes(wall, timeZone) * 60_000;
    return wall - offsetMinutes(guess, timeZone) * 60_000;
  };
  for (let day = 0; day < 3; day++) {
    const candidate = onDay(day);
    if (candidate > at) return candidate;
  }
  return at + DAY_MS;
}
