import { loadPage, looksLikeListing, type LayoutBox } from './page.ts';
import type { PriceHints } from './parse.ts';
import {
  fromHeuristics,
  fromJsonLd,
  fromMetaTags,
  fromMicrodata,
  fromSelector,
  stockFromPage,
  type Candidate,
  type Recipe,
  type Strategy,
  type StrategyResult,
} from './strategies.ts';

export interface Extraction {
  /** Whole minor units, or null when no reading was good enough. */
  amount: number | null;
  currency: string | null;
  was: number | null;
  inStock: boolean | null;
  /** 0 to 1, from every strategy that agreed. */
  confidence: number;
  /** The most trusted strategy behind the answer. */
  strategy: Strategy | null;
  agreeing: Strategy[];
  /** Two trusted strategies read different prices: check again before believing either. */
  conflict: boolean;
  /** A page of many products, not one: only structured data may name a price here. */
  listing: boolean;
  /** Where the winning price sits on the page, when a selector can point at it. */
  locator: string | null;
  /** The attribute to read there, when the price isn't the element's text. */
  locatorAttribute: string | null;
  results: StrategyResult[];
}

export interface ExtractInput {
  html: string;
  /** The selector saved for this site, if there is one. */
  recipe?: Recipe | null;
  hints?: PriceHints;
  /** How each price looked, when the page was rendered in a browser. */
  boxes?: readonly LayoutBox[];
}

/** Below this, a price read only by the heuristics isn't trusted at all. */
export const ACCEPT = 0.4;

const ORDER: Strategy[] = ['selector', 'json-ld', 'microdata', 'meta', 'heuristic'];
const POINT_AT: Strategy[] = ['heuristic', 'selector', 'microdata'];
const TRUSTED = 0.75;

/**
 * Reads a product's price five ways and decides between them. Strategies that
 * agree add up; a heuristic guess on its own must clear ACCEPT; two trusted
 * strategies that disagree are flagged as a conflict rather than settled.
 */
export function extract({ html, recipe, hints = {}, boxes = [] }: ExtractInput): Extraction {
  const page = loadPage(html);
  const structured = [
    fromJsonLd(page, hints),
    fromMicrodata(page, hints),
    fromMetaTags(page, hints),
  ];

  // The currency the page declares settles "$" and "kr" for the readings that follow.
  const declared = structured.flatMap((r) => r.candidates).find((c) => c.currency)?.currency;
  const pageHints = { currency: hints.currency ?? declared ?? null };
  // On a listing, a saved selector or the heuristics would only find some product's card.
  const listing = looksLikeListing(page, pageHints);
  const skipped = (strategy: Strategy): StrategyResult => ({
    strategy,
    status: 'skipped',
    candidates: [],
  });
  const results = [
    listing ? skipped('selector') : fromSelector(page, recipe, pageHints),
    ...structured,
    listing ? skipped('heuristic') : fromHeuristics(page, pageHints, boxes),
  ];

  const best = results.map((r) => r.candidates[0]).filter((c): c is Candidate => Boolean(c));
  const groups = new Map<string, Candidate[]>();
  for (const candidate of best) {
    const key = `${candidate.amount}:${candidate.currency ?? pageHints.currency ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const weight = (group: Candidate[]) => group.reduce((sum, c) => sum + c.confidence, 0);
  const ranked = [...groups.values()].sort(
    (a, b) =>
      weight(b) - weight(a) || ORDER.indexOf(a[0]!.strategy) - ORDER.indexOf(b[0]!.strategy),
  );
  const winner = ranked[0] ?? [];
  const confidence = 1 - winner.reduce((miss, c) => miss * (1 - c.confidence), 1);
  const trustedGroups = ranked.filter((group) =>
    group.some((c) => c.strategy !== 'heuristic' && c.confidence >= TRUSTED),
  );

  const accepted = winner.length > 0 && confidence >= ACCEPT;
  // Where to point next time: the price people see, if it agreed; then the saved
  // selector; then markup like a <meta> tag, with the attribute that holds the price.
  const pointer = accepted
    ? POINT_AT.map((s) => winner.find((c) => c.strategy === s && c.locator)).find(Boolean)
    : undefined;
  const agreeing = ORDER.filter((s) => winner.some((c) => c.strategy === s));
  const lead = winner.find((c) => c.strategy === agreeing[0]);
  const inStock =
    best.find((c) => c.inStock !== undefined && c.inStock !== null)?.inStock ?? stockFromPage(page);

  return {
    amount: accepted ? (lead?.amount ?? null) : null,
    currency: accepted ? (lead?.currency ?? pageHints.currency) : null,
    was: accepted ? (winner.find((c) => c.was)?.was ?? null) : null,
    inStock,
    confidence: accepted ? confidence : 0,
    strategy: accepted ? (agreeing[0] ?? null) : null,
    agreeing: accepted ? agreeing : [],
    conflict: trustedGroups.length > 1,
    listing,
    locator: pointer?.locator ?? null,
    locatorAttribute: pointer?.attribute ?? null,
    results,
  };
}
