import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { describe, expect, it } from 'vitest';
import { looksGenerated, selectorFor } from './selector.ts';

describe('looksGenerated', () => {
  it.each(['css-1x2y3z', 'sc-bdVaJa', 'a8k2x9', 'jsx-3021'])('spots %s as generated', (token) => {
    expect(looksGenerated(token)).toBe(true);
  });

  it.each(['price-now', 'product_main', 'col-12', 'mt-5', 'pdp__amount'])('keeps %s', (token) => {
    expect(looksGenerated(token)).toBe(false);
  });
});

describe('selectorFor', () => {
  const pick = (html: string, query: string) => {
    const $ = cheerio.load(html);
    const element = $(query)[0] as Element;
    const selector = selectorFor($, element);
    expect($(selector).toArray()).toEqual([element]);
    return selector;
  };

  it('prefers a stable id', () => {
    expect(pick('<p id="price">£1</p><p>£2</p>', 'p')).toBe('#price');
  });

  it('then an attribute someone put there on purpose', () => {
    expect(pick('<div class="css-a8k2x9" data-testid="price">£1</div>', 'div')).toBe(
      '[data-testid="price"]',
    );
  });

  it('then a stable class, ignoring generated ones', () => {
    expect(pick('<span class="css-a8k2x9 price-now">£1</span>', 'span')).toBe('.price-now');
  });

  it('falls back to a short path from an ancestor it can point at', () => {
    const selector = pick(
      '<main id="product"><div class="css-a8k2x9"><span>£1</span></div><div class="css-b9l3y0"><span>£2</span></div></main>',
      'main div:first-child span',
    );
    expect(selector).toContain('#product');
    expect(selector).not.toContain('css-');
  });
});
