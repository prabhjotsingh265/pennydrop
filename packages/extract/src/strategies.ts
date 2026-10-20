import type { Element } from 'domhandler';
import { findPrices, parseAmount, type PriceHints } from './parse.ts';
import {
  distance,
  isChrome,
  isMarkedPrice,
  isRelated,
  isWasPrice,
  textNodes,
  type Page,
} from './page.ts';
import { selectorFor } from './selector.ts';

export type Strategy = 'selector' | 'json-ld' | 'microdata' | 'meta' | 'heuristic';

export interface Candidate {
  strategy: Strategy;
  /** Whole minor units. */
  amount: number;
  currency: string | null;
  /** 0 to 1: how much this reading should be trusted on its own. */
  confidence: number;
  was?: number | null;
  inStock?: boolean | null;
  /** A selector for the element it came from, when it came from one. */
  locator?: string;
  /** Why it was read this way, in words. */
  note: string;
}

export interface StrategyResult {
  strategy: Strategy;
  status: 'found' | 'missing' | 'skipped';
  /** Best first. */
  candidates: Candidate[];
}

export interface Recipe {
  selector: string;
  /** Read this attribute instead of the element's text. */
  attribute?: string;
  /** A regular expression whose first group is the price. */
  pattern?: string;
}

const result = (strategy: Strategy, candidates: Candidate[]): StrategyResult => ({
  strategy,
  status: candidates.length ? 'found' : 'missing',
  candidates: candidates.sort((a, b) => b.confidence - a.confidence),
});

function availability(value: unknown): boolean | null {
  if (typeof value !== 'string') return null;
  if (/(InStock|LimitedAvailability|OnlineOnly|InStoreOnly|PreOrder)$/i.test(value)) return true;
  if (/(OutOfStock|SoldOut|Discontinued)$/i.test(value)) return false;
  return null;
}

const asArray = <T>(value: T | T[] | undefined | null): T[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

type Json = Record<string, unknown>;

const typed = (node: Json, type: string) =>
  asArray(node['@type'] as string | string[]).includes(type);

/** Strategy 1: a Product's offers in JSON-LD, the structured data most shops publish. */
export function fromJsonLd(page: Page, hints: PriceHints): StrategyResult {
  const products: Json[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (!value || typeof value !== 'object') return;
    const node = value as Json;
    if (typed(node, 'Product') || typed(node, 'ProductGroup')) products.push(node);
    collect(node['@graph']);
    collect(node.mainEntity);
    collect(node.hasVariant);
  };
  page.$('script[type="application/ld+json"]').each((_, el) => {
    try {
      collect(JSON.parse(page.$(el).text()));
    } catch {
      // Broken JSON-LD is common in the wild; the other strategies carry on.
    }
  });

  const offers = products.flatMap((product) => asArray(product.offers as Json | Json[]));
  const candidates: Candidate[] = [];
  for (const offer of offers) {
    const spec = (offer.priceSpecification ?? {}) as Json;
    const currency = (offer.priceCurrency ?? spec.priceCurrency ?? hints.currency ?? null) as
      string | null;
    const inStock = availability(offer.availability);
    if (typed(offer, 'AggregateOffer')) {
      const amount = parseAmount(offer.lowPrice ?? offer.price, currency);
      if (amount) {
        const count = offer.offerCount ? `${offer.offerCount} offers` : 'several offers';
        candidates.push({
          strategy: 'json-ld',
          amount,
          currency,
          confidence: 0.7,
          inStock,
          note: `the lowest of ${count}`,
        });
      }
      continue;
    }
    const amount = parseAmount(offer.price ?? spec.price, currency);
    if (amount) {
      const single = offers.length === 1;
      candidates.push({
        strategy: 'json-ld',
        amount,
        currency,
        confidence: single ? 0.95 : 0.75,
        inStock,
        note: single
          ? 'the product’s offer'
          : `one of ${offers.length} offers${offer.sku ? `, SKU ${offer.sku}` : ''}`,
      });
    }
  }
  return result('json-ld', candidates);
}

/** Strategy 2: itemprop="price" in the page's own markup. */
export function fromMicrodata(page: Page, hints: PriceHints): StrategyResult {
  const { $ } = page;
  const prices = $('[itemprop="price"]').toArray();
  const candidates = prices.flatMap((el): Candidate[] => {
    const scope = $(el).closest('[itemscope]');
    const currencyEl = scope.find('[itemprop="priceCurrency"]').first();
    const currency = (currencyEl.attr('content') ||
      currencyEl.text().trim() ||
      hints.currency ||
      null) as string | null;
    const content = $(el).attr('content');
    const amount =
      content !== undefined
        ? parseAmount(content, currency)
        : (findPrices($(el).text(), { currency })[0]?.amount ??
          parseAmount($(el).text(), currency));
    if (!amount) return [];
    const stock = scope.find('[itemprop="availability"]').first();
    return [
      {
        strategy: 'microdata',
        amount,
        currency,
        confidence: prices.length === 1 ? 0.9 : 0.7,
        inStock: availability(stock.attr('href') ?? stock.attr('content')),
        locator: selectorFor($, el),
        note: 'marked itemprop="price"',
      },
    ];
  });
  return result('microdata', candidates);
}

/** Strategy 3: price meta tags (Open Graph and the product: namespace). */
export function fromMetaTags(page: Page, hints: PriceHints): StrategyResult {
  const { $ } = page;
  const content = (property: string) => $(`meta[property="${property}"]`).attr('content');
  const value = content('product:price:amount') ?? content('og:price:amount');
  const currency =
    content('product:price:currency') ?? content('og:price:currency') ?? hints.currency ?? null;
  const amount = parseAmount(value, currency);
  return result(
    'meta',
    amount
      ? [{ strategy: 'meta', amount, currency, confidence: 0.8, note: 'the page’s price meta tag' }]
      : [],
  );
}

/** Strategy 4: the selector saved for this site. */
export function fromSelector(
  page: Page,
  recipe: Recipe | null | undefined,
  hints: PriceHints,
): StrategyResult {
  if (!recipe) return { strategy: 'selector', status: 'skipped', candidates: [] };
  let matches: Element[];
  try {
    matches = page.$(recipe.selector).toArray() as Element[];
  } catch {
    return result('selector', []);
  }
  const first = matches[0];
  if (!first) return result('selector', []);
  let raw = recipe.attribute ? (page.$(first).attr(recipe.attribute) ?? '') : page.$(first).text();
  if (recipe.pattern) raw = new RegExp(recipe.pattern).exec(raw)?.[1] ?? '';
  const found = findPrices(raw, hints)[0];
  const amount = found?.amount ?? parseAmount(raw, hints.currency ?? null);
  if (!amount) return result('selector', []);
  return result('selector', [
    {
      strategy: 'selector',
      amount,
      currency: found?.currency ?? hints.currency ?? null,
      confidence: matches.length === 1 ? 0.9 : 0.7,
      locator: recipe.selector,
      note: `${recipe.selector} → ${raw.trim()}`,
    },
  ]);
}

const SMALL_PRINT =
  /\b(delivery|shipping|postage|over|save|off|per|month|monthly|from|finance|deposit|tax|vat|voucher|coupon)\b/i;

/**
 * Strategy 5: read the page like a person would. Every price-shaped piece of
 * text is scored on where it sits: near the title or the buy button, marked
 * as a price, or tucked away in related products, the header or small print.
 */
export function fromHeuristics(page: Page, hints: PriceHints): StrategyResult {
  type Scored = Candidate & { element: Element };
  const scored: Scored[] = [];
  const was: { amount: number; element: Element }[] = [];

  for (const { text, element } of textNodes(page)) {
    for (const price of findPrices(text, hints)) {
      if (isWasPrice(element)) {
        was.push({ amount: price.amount, element });
        continue;
      }
      let score = 0.35;
      const reasons: string[] = [];
      if (page.title && distance(element, page.title) <= 4) {
        score += 0.15;
        reasons.push('next to the title');
      } else if (page.title && distance(element, page.title) <= 6) {
        score += 0.07;
      }
      if (page.buyButtons.some((button) => distance(element, button) <= 4)) {
        score += 0.1;
        reasons.push('near the buy button');
      }
      if (isMarkedPrice(element)) {
        score += 0.15;
        reasons.push('marked as a price');
      }
      if (text.trim().length > 40 || SMALL_PRINT.test(text)) {
        score -= 0.25;
        reasons.push('in small print');
      }
      if (isChrome(element)) score -= 0.2;
      if (isRelated(page, element)) {
        score = 0.08;
        reasons.splice(0, reasons.length, 'in another product’s listing');
      }
      scored.push({
        strategy: 'heuristic',
        amount: price.amount,
        currency: price.currency,
        confidence: Math.min(Math.max(score, 0.05), 0.75),
        note: reasons.join(', ') || 'price-shaped text',
        element,
      });
    }
  }

  // The same price written twice near each other (books.toscrape's tax table)
  // backs itself up a little.
  for (const candidate of scored) {
    const repeats = scored.filter(
      (o) => o !== candidate && o.amount === candidate.amount && o.confidence > 0.3,
    ).length;
    candidate.confidence = Math.min(candidate.confidence + Math.min(repeats, 2) * 0.03, 0.75);
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  const candidates = scored.map(({ element, ...candidate }) => {
    const old = was
      .filter((w) => w.amount > candidate.amount && distance(w.element, element) <= 4)
      .sort((a, b) => distance(a.element, element) - distance(b.element, element))[0];
    return { ...candidate, was: old?.amount ?? null, locator: selectorFor(page.$, element) };
  });
  return result('heuristic', candidates);
}

/** In stock, out of stock, or can't tell, from the words and buttons on the page. */
export function stockFromPage(page: Page): boolean | null {
  if (page.buyButtons.some((button) => button.attribs.disabled !== undefined)) return false;
  const words = textNodes(page)
    .filter(({ element }) => !isRelated(page, element) && !isChrome(element))
    .map(({ text }) => text)
    .join(' ');
  if (/\b(out of stock|sold out|currently unavailable|no longer available)\b/i.test(words))
    return false;
  if (/\bin stock\b/i.test(words)) return true;
  return null;
}
