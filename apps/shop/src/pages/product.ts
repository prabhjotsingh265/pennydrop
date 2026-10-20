import { CATEGORIES, type Product } from '../catalogue.ts';
import { html, raw, scriptJson, type Html } from '../html.ts';
import { formatPence, type Quote } from '../prices.ts';
import { hash01 } from '../random.ts';
import type { ShopName, ShopSettings } from '../settings.ts';
import { namer, shell, type Layout } from './shell.ts';

export interface Listed {
  product: Product;
  quote: Quote;
}

const decimal = (pence: number) => (pence / 100).toFixed(2);
const availability = (quote: Quote) =>
  `https://schema.org/${quote.inStock ? 'InStock' : 'OutOfStock'}`;

export function productPath(product: Product): string {
  return `${product.clearance ? '/clearance' : '/p'}/${product.slug}`;
}

function rating(product: Product) {
  const stars = 3 + Math.floor(hash01(product.slug, 'stars') * 3);
  const reviews = 12 + Math.floor(hash01(product.slug, 'reviews') * 380);
  return { stars: '★'.repeat(stars) + '☆'.repeat(5 - stars), reviews };
}

/** A product in a grid: picture, name, price. Related products and listings both use it. */
export function tile(layout: Layout, { product, quote }: Listed): Html {
  const k = namer(layout);
  return html`<a class="${k('card')}" href="${productPath(product)}">
    <img src="/art/${product.slug}.svg" alt="" width="400" height="400" loading="lazy" />
    <p class="${k('card-name')}">${product.name}</p>
    <span class="${k('card-price')}">${formatPence(quote.price)}</span>
  </a>`;
}

function related(layout: Layout, others: Listed[]): Html {
  const k = namer(layout);
  return html`<section class="${k('related')}">
    <h2>You might also like</h2>
    <div class="grid">${others.map((other) => tile(layout, other))}</div>
  </section>`;
}

interface ProductPage {
  shop: ShopName;
  settings: ShopSettings;
  product: Product;
  quote: Quote;
  others: Listed[];
}

/** The classic layout: clean, semantic, and carrying whichever structured data is switched on. */
function classic({ settings, product, quote, others }: ProductPage): Html {
  const scope = settings.microdata ? raw(' itemscope itemtype="https://schema.org/Product"') : '';
  const prop = (name: string) => (settings.microdata ? raw(` itemprop="${name}"`) : '');
  const { stars, reviews } = rating(product);

  return html`<main class="product"${scope}>
    <nav class="breadcrumb">
      <a href="/">Home</a> / <a href="/c/${product.category}">${CATEGORIES[product.category]}</a>
    </nav>
    <div class="product-grid">
      <img class="product-image" src="/art/${product.slug}.svg" alt="${product.name}" width="400" height="400"${prop('image')} />
      <div class="product-info">
        <h1 class="product-title"${prop('name')}>${product.name}</h1>
        <p class="rating"><span class="stars">${stars}</span> ${reviews} reviews</p>
        <p class="price">
          <span class="price-now">${formatPence(quote.price)}</span>
          ${quote.was ? html`<s class="price-was">${formatPence(quote.was)}</s> <span class="sale-badge">Sale</span>` : ''}
        </p>
        ${
          settings.microdata
            ? html`<div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
                <meta itemprop="price" content="${decimal(quote.price)}" />
                <meta itemprop="priceCurrency" content="${quote.currency}" />
                <link itemprop="availability" href="${availability(quote)}" />
              </div>`
            : ''
        }
        <p class="stock${quote.inStock ? '' : ' out'}">${quote.inStock ? 'In stock' : 'Out of stock'}</p>
        <button class="add-to-basket"${quote.inStock ? '' : raw(' disabled')}>
          ${quote.inStock ? 'Add to basket' : 'Sold out'}
        </button>
        <p class="blurb"${prop('description')}>${product.blurb}</p>
        <dl class="details"><dt>SKU</dt><dd${prop('sku')}>${product.sku}</dd></dl>
      </div>
    </div>
    ${related('classic', others)}
  </main>`;
}

/** The redesign: everything renamed and moved, and no structured data at all. */
function redesign({ product, quote, others }: ProductPage): Html {
  const { stars, reviews } = rating(product);
  return html`<main class="pdp">
    <div class="pdp__hero">
      <img src="/art/${product.slug}.svg" alt="${product.name}" width="400" height="400" />
    </div>
    <div class="pdp__head">
      <div>
        <h1 class="pdp__name">${product.name}</h1>
        <p class="pdp__rating">${stars} ${reviews} reviews</p>
      </div>
      <div class="pdp__pricing">
        <div class="pdp__amount${quote.was ? ' is-sale' : ''}" data-price>
          ${formatPence(quote.price)}
        </div>
        ${quote.was ? html`<span class="pdp__was">was <s>${formatPence(quote.was)}</s> · Sale</span>` : ''}
      </div>
    </div>
    <p class="pdp__stock">${quote.inStock ? 'In stock, ready to send' : 'Out of stock'}</p>
    <button class="pdp__cta" ${quote.inStock ? '' : raw(' disabled')}>
      ${quote.inStock ? 'Add to basket' : 'Sold out'}
    </button>
    <p class="pdp__copy">${product.blurb}</p>
    ${related('redesign', others)}
  </main>`;
}

/**
 * The modern layout: generated class names, and the price is fetched by a
 * script after the page loads, so it's not in the HTML at all. Related
 * products still carry prices in the HTML: a trap for anything that reads
 * the plain page and grabs the first price it sees.
 */
function modern({ product, others }: ProductPage): Html {
  const m = namer('modern');
  return html`<main class="${m('page')}">
      <div class="${m('media')}">
        <img src="/art/${product.slug}.svg" alt="${product.name}" width="400" height="400" />
      </div>
      <div>
        <h1 class="${m('title')}">${product.name}</h1>
        <div class="${m('price')}" data-testid="price"></div>
        <div class="${m('was')}" data-testid="was"></div>
        <div class="${m('stock')}" data-testid="stock"></div>
        <button class="${m('cta')}">Add to basket</button>
        <p class="${m('copy')}">${product.blurb}</p>
      </div>
      <div class="${m('related')}">${related('modern', others)}</div>
    </main>
    <script>
      (async () => {
        const quote = await fetch('/api/price/' + ${scriptJson(product.slug)}).then((r) =>
          r.json(),
        );
        document.querySelector('[data-testid=price]').textContent = quote.display;
        document.querySelector('[data-testid=was]').textContent = quote.wasDisplay
          ? 'was ' + quote.wasDisplay
          : '';
        document.querySelector('[data-testid=stock]').textContent = quote.inStock
          ? 'In stock'
          : 'Out of stock';
      })();
    </script>`;
}

/** Structured data for the page head, as each setting allows. Only the classic layout has any. */
function head({ settings, product, quote, shop }: ProductPage): Html {
  if (settings.layout !== 'classic') return html``;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.blurb,
    image: `/art/${product.slug}.svg`,
    sku: product.sku,
    gtin13: product.gtin13,
    brand: { '@type': 'Brand', name: shop },
    offers: {
      '@type': 'Offer',
      price: decimal(quote.price),
      priceCurrency: quote.currency,
      availability: availability(quote),
      url: productPath(product),
    },
  };
  return html`${
    settings.jsonLd
      ? html`<script type="application/ld+json">
          ${scriptJson(jsonLd)}
        </script>`
      : ''
  }
  ${
    settings.metaTags
      ? html`<meta property="og:type" content="product" />
          <meta property="product:price:amount" content="${decimal(quote.price)}" />
          <meta property="product:price:currency" content="${quote.currency}" />`
      : ''
  }`;
}

const LAYOUTS: Record<Layout, (page: ProductPage) => Html> = { classic, redesign, modern };

export function productPage(page: ProductPage): string {
  return shell({
    shop: page.shop,
    layout: page.settings.layout,
    title: page.product.name,
    description: page.product.blurb,
    head: head(page),
    body: LAYOUTS[page.settings.layout](page),
  });
}
