import type { SiteSummary } from '@pennydrop/domain';

export type Health = { label: string; tone: 'good' | 'warn' | 'bad' };

/** How a shop is doing, in a word or two. */
export function siteHealth(site: SiteSummary, now: number): Health {
  if (site.policy !== 'allowed') return { label: 'Not allowed', tone: 'bad' };
  const until = site.breaker.openUntil ? Date.parse(site.breaker.openUntil) : null;
  if (site.breaker.state === 'open' && until !== null && until > now) {
    return { label: 'Resting', tone: 'warn' };
  }
  if (site.breaker.state === 'half_open') return { label: 'Trying again', tone: 'warn' };
  const { checks, good } = site.lastDay;
  if (checks >= 4 && good / checks < 0.5) return { label: 'Struggling', tone: 'warn' };
  return { label: 'Healthy', tone: 'good' };
}

/** Our own pace on a shop: "one visit every 10 s, one at a time". */
export function paceWords(site: Pick<SiteSummary, 'minGapMs' | 'maxInFlight' | 'crawlDelay'>) {
  const gap = Math.max(site.minGapMs, (site.crawlDelay ?? 0) * 1000) / 1000;
  const every = gap === 1 ? 'every second' : `every ${Number(gap.toFixed(1))} s`;
  const together = site.maxInFlight === 1 ? 'one at a time' : `${site.maxInFlight} at a time`;
  return `One visit ${every}, ${together}`;
}

export function robotsWords(site: Pick<SiteSummary, 'robots' | 'crawlDelay'>): string {
  const delay = site.crawlDelay ? `; it asks for ${site.crawlDelay} s between visits` : '';
  switch (site.robots.status) {
    case 'ok':
      return `robots.txt read${delay}`;
    case 'missing':
      return 'No robots.txt, so everything is allowed';
    case 'unreachable':
      return 'robots.txt doesn’t answer, so nothing is checked until it does';
    default:
      return 'robots.txt not read yet';
  }
}

export function recipeWords(source: string): string {
  switch (source) {
    case 'user':
      return 'picked by you';
    case 'healed':
      return 'found again after a redesign';
    default:
      return 'found automatically';
  }
}
