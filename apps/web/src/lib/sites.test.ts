import type { SiteSummary } from '@pennydrop/domain';
import { describe, expect, it } from 'vitest';
import { paceWords, robotsWords, siteHealth } from './sites.ts';

const NOW = Date.UTC(2026, 9, 21, 12);
const site = (extra: Partial<SiteSummary> = {}): SiteSummary => ({
  id: 's',
  host: 'shop.example.com',
  products: 1,
  policy: 'allowed',
  robots: { status: 'ok', fetchedAt: null },
  crawlDelay: null,
  minGapMs: 10_000,
  maxInFlight: 1,
  needsBrowser: false,
  breaker: { state: 'closed', openUntil: null },
  recipe: null,
  lastDay: { checks: 10, good: 10, medianMs: 80 },
  ...extra,
});

describe('siteHealth', () => {
  it('reads healthy, resting, struggling or not allowed', () => {
    expect(siteHealth(site(), NOW).label).toBe('Healthy');
    expect(
      siteHealth(
        site({ breaker: { state: 'open', openUntil: new Date(NOW + 60_000).toISOString() } }),
        NOW,
      ).label,
    ).toBe('Resting');
    // A breaker whose rest is over is about to try again: not "resting" any more.
    expect(
      siteHealth(
        site({ breaker: { state: 'open', openUntil: new Date(NOW - 1).toISOString() } }),
        NOW,
      ).label,
    ).toBe('Healthy');
    expect(siteHealth(site({ lastDay: { checks: 10, good: 3, medianMs: 9 } }), NOW).label).toBe(
      'Struggling',
    );
    expect(siteHealth(site({ policy: 'blocked' }), NOW).tone).toBe('bad');
  });
});

describe('words for a site', () => {
  it('says our pace, taking the crawl delay into account', () => {
    expect(paceWords(site())).toBe('One visit every 10 s, one at a time');
    expect(paceWords(site({ minGapMs: 1_000, maxInFlight: 2 }))).toBe(
      'One visit every second, 2 at a time',
    );
    expect(paceWords(site({ minGapMs: 1_000, crawlDelay: 2 }))).toBe(
      'One visit every 2 s, one at a time',
    );
  });

  it('explains robots.txt', () => {
    expect(robotsWords(site({ crawlDelay: 2 }))).toBe(
      'robots.txt read; it asks for 2 s between visits',
    );
    expect(robotsWords(site({ robots: { status: 'missing', fetchedAt: null } }))).toBe(
      'No robots.txt, so everything is allowed',
    );
  });
});
