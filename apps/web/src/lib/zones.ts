// Browsers still report some places by their old names. Shown by today's names instead.
const RENAMED: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
};

/** The browser's own spelling of a zone: "Asia/Kolkata" and "Asia/Calcutta" come out the same. */
export function canonicalZone(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return zone;
  }
}

export const sameZone = (a: string, b: string) => canonicalZone(a) === canonicalZone(b);

/** A zone by today's name: "Asia/Calcutta" reads as "Asia/Kolkata". */
export function zoneName(zone: string): string {
  const canonical = canonicalZone(zone);
  return RENAMED[canonical] ?? canonical;
}

/** The device's own time zone. */
export function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Every time zone the browser knows, for the Settings list. */
export function allZones(): string[] {
  return Intl.supportedValuesOf('timeZone');
}

/** "Asia/Calcutta" as "Asia / Kolkata (UTC+05:30)". */
export function zoneLabel(zone: string, at = Date.now()): string {
  const offset =
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  const name = zoneName(zone).replace(/_/g, ' ').replace(/\//g, ' / ');
  // "GMT", "GMT+00:00" and "GMT+05:30" read as "UTC", "UTC" and "UTC+05:30".
  const utc = offset.replace('GMT', 'UTC');
  return `${name} (${utc === 'UTC+00:00' ? 'UTC' : utc})`;
}
