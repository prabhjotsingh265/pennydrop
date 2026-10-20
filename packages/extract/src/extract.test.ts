import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extract } from './extract.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}.html`, import.meta.url), 'utf8');

describe('the practice shop, in each layout', () => {
  it('reads the classic layout four ways, all agreeing', () => {
    const result = extract({ html: fixture('fickle-classic') });
    expect(result).toMatchObject({
      amount: 3199,
      currency: 'GBP',
      was: 3799,
      inStock: true,
      conflict: false,
    });
    expect(result.agreeing).toEqual(['json-ld', 'microdata', 'meta', 'heuristic']);
    expect(result.confidence).toBeGreaterThan(0.99);
  });

  it('notices when it is sold out', () => {
    expect(extract({ html: fixture('fickle-classic-sold-out') }).inStock).toBe(false);
  });

  it('still finds the price after the redesign removes every bit of structured data', () => {
    const result = extract({ html: fixture('fickle-redesign') });
    expect(result).toMatchObject({
      amount: 3199,
      was: 3799,
      strategy: 'heuristic',
      locator: '[data-price]',
    });
  });

  it('refuses to guess when the only prices in the HTML belong to other products', () => {
    const result = extract({ html: fixture('fickle-modern') });
    expect(result.amount).toBeNull();
    expect(
      result.results.find((r) => r.strategy === 'heuristic')?.candidates.length,
    ).toBeGreaterThan(0);
  });
});

describe('the outside practice sites', () => {
  it('reads books.toscrape.com from the page alone', () => {
    expect(extract({ html: fixture('books-toscrape') })).toMatchObject({
      amount: 5177,
      currency: 'GBP',
      inStock: true,
      locator: '.price_color',
    });
  });

  it('reads web-scraping.dev, with its "full price" as the was price', () => {
    const result = extract({ html: fixture('web-scraping-dev') });
    expect(result).toMatchObject({ amount: 999, currency: 'USD', was: 1299, strategy: 'json-ld' });
    expect(result.agreeing).toContain('heuristic');
  });
});

describe('healing', () => {
  it('writes a new selector when the saved one stops matching, and the new one works', () => {
    const html = fixture('fickle-redesign');
    const broken = extract({ html, recipe: { selector: '.price-now' } });
    expect(broken.results[0]).toMatchObject({ strategy: 'selector', status: 'missing' });
    expect(broken.amount).toBe(3199);

    const healed = extract({ html, recipe: { selector: broken.locator! } });
    expect(healed.results[0]?.candidates[0]?.amount).toBe(3199);
    expect(healed.agreeing).toEqual(['selector', 'heuristic']);
  });
});

const page = (body: string, head = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('deciding between readings', () => {
  it('flags two trusted strategies that disagree', () => {
    const html = page(
      '<div itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">Lamp</h1>' +
        '<div itemprop="offers" itemscope itemtype="https://schema.org/Offer"><meta itemprop="price" content="12.00"><meta itemprop="priceCurrency" content="GBP"></div></div>',
      '<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"10.00","priceCurrency":"GBP"}}</script>',
    );
    expect(extract({ html }).conflict).toBe(true);
  });

  it('reads an attribute and a pattern when the recipe asks', () => {
    const html = page('<h1>Lamp</h1><div class="buy" data-amount="Price: 12.50">£12.50</div>');
    const result = extract({
      html,
      recipe: { selector: '.buy', attribute: 'data-amount', pattern: 'Price: ([\\d.]+)' },
      hints: { currency: 'GBP' },
    });
    expect(result.results[0]?.candidates[0]).toMatchObject({ amount: 1250, currency: 'GBP' });
  });

  it('skips broken JSON-LD and carries on', () => {
    const html = page(
      '<h1>Lamp</h1><p class="price">£20.00</p><button>Add to basket</button>',
      '<script type="application/ld+json">{"@type": "Product", oops}</script>',
    );
    expect(extract({ html }).amount).toBe(2000);
  });

  it('prefers the product’s price to delivery small print and header offers', () => {
    const html = page(
      '<header><p>Today only: everything from £5</p></header>' +
        '<main><h1>Lamp</h1><p>Free delivery on orders over £50</p><p class="price">£20.00</p><button>Add to basket</button></main>',
    );
    expect(extract({ html }).amount).toBe(2000);
  });
});
