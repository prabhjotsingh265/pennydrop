import type { WatchEvent } from '@pennydrop/domain';

/** Each event in a sentence, for the timeline. */
export function eventWords(event: Pick<WatchEvent, 'kind' | 'details'>): string {
  switch (event.kind) {
    case 'layout_changed':
      return 'The shop changed its page layout.';
    case 'selector_healed':
      return 'Found the price another way, and kept reading it.';
    case 'needs_browser':
      return 'The price now only appears once the page runs its scripts, so it’s read in a browser.';
    case 'breaker_opened':
      return 'The shop kept failing, so checks paused for a while.';
    case 'breaker_closed':
      return 'The shop answered properly again; checks carried on.';
    case 'blocked':
      return 'The shop refused our checks three times in a row.';
    case 'robots_disallowed':
      return 'The shop’s robots.txt now asks robots not to visit this page, so we stopped.';
    case 'suspicious_price':
      return 'A big price jump was held back until a second check confirmed it.';
    case 'out_of_stock':
      return 'Sold out.';
    case 'back_in_stock':
      return 'Back in stock.';
    case 'gone':
      return 'The page has gone.';
    default:
      return event.kind.replace(/_/g, ' ');
  }
}

/** The few events worth a flag on the chart itself, with a one-word label. */
export function chartFlag(kind: string): string | null {
  switch (kind) {
    case 'layout_changed':
      return 'Redesign';
    case 'out_of_stock':
      return 'Sold out';
    case 'back_in_stock':
      return 'Back';
    default:
      return null;
  }
}

const OUTCOMES: Record<string, string> = {
  ok: 'Read',
  unchanged: 'Unchanged',
  suspicious: 'Held for a second look',
  price_not_found: 'No price found',
  blocked: 'Refused by the shop',
  rate_limited: 'Asked to slow down',
  http_error: 'Shop error',
  gone: 'Page gone',
  robots_disallowed: 'Ruled out by robots.txt',
  timeout: 'Too slow',
  network_error: 'Couldn’t connect',
  too_large: 'Page too large',
  not_html: 'Not a web page',
  blocked_address: 'Private address',
  skipped_breaker_open: 'Skipped while the shop rests',
};

/** A check's outcome in a few words. */
export function outcomeWords(outcome: string): string {
  return OUTCOMES[outcome] ?? outcome.replace(/_/g, ' ');
}

/** Did the check read the page properly? */
export const isGoodOutcome = (outcome: string) =>
  outcome === 'ok' || outcome === 'unchanged' || outcome === 'suspicious';
