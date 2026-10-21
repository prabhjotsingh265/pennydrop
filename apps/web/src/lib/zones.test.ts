import { describe, expect, it } from 'vitest';
import { allZones, canonicalZone, sameZone, zoneLabel, zoneName } from './zones.ts';

describe('time zones', () => {
  it('labels a zone by today’s name, with its offset from UTC', () => {
    expect(zoneLabel('Asia/Kolkata')).toBe('Asia / Kolkata (UTC+05:30)');
    expect(zoneLabel('Asia/Calcutta')).toBe('Asia / Kolkata (UTC+05:30)');
    expect(zoneLabel('America/New_York', Date.UTC(2026, 0, 15))).toBe(
      'America / New York (UTC-05:00)',
    );
    expect(zoneLabel('Europe/London', Date.UTC(2026, 0, 15))).toBe('Europe / London (UTC)');
  });

  it('treats an old and a new name for one place as the same zone', () => {
    expect(sameZone('Asia/Kolkata', 'Asia/Calcutta')).toBe(true);
    expect(sameZone('Europe/Kyiv', 'Europe/Kiev')).toBe(true);
    expect(sameZone('Asia/Kolkata', 'Europe/London')).toBe(false);
    expect(zoneName('Asia/Calcutta')).toBe('Asia/Kolkata');
  });

  it('finds every workspace’s zone in the list, whichever name it was saved under', () => {
    expect(allZones()).toContain(canonicalZone('Asia/Kolkata'));
    expect(allZones()).toContain('Europe/London');
  });
});
