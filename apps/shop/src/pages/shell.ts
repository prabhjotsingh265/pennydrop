import { html, raw, type Html } from '../html.ts';
import { hash01 } from '../random.ts';
import type { ShopName, ShopSettings } from '../settings.ts';
import { SHOPS } from '../settings.ts';

export type Layout = ShopSettings['layout'];

/**
 * Class names per layout. The redesign renames everything; the modern layout
 * uses generated names like a CSS-in-JS site, so no two builds look alike to
 * a selector, but they are stable within one.
 */
export function namer(layout: Layout): (name: string) => string {
  if (layout === 'classic') return (name) => name;
  if (layout === 'redesign') return (name) => `pdp__${name}`;
  return (name) =>
    `css-${Math.floor(hash01('modern', name) * 36 ** 6)
      .toString(36)
      .padStart(6, '0')}`;
}

const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;color:#1d1b18;background:#fff}
a{color:inherit}
img{display:block;max-width:100%;height:auto}
.practice{margin:0;padding:6px 16px;background:#f6f2ec;color:#6d655c;font-size:12px;text-align:center}
.site-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px max(16px,5vw);border-bottom:1px solid #ece6de}
.site-header .logo{font-weight:900;font-size:24px;letter-spacing:-.03em;text-decoration:none;text-transform:lowercase}
.site-header nav{display:flex;gap:20px;font-size:14px}
.site-header nav a{text-decoration:none}
.site-footer{margin-top:64px;padding:24px max(16px,5vw);border-top:1px solid #ece6de;color:#8a8178;font-size:13px}
.listing{padding:24px max(16px,5vw)}
.listing h1{font:400 34px/1.15 Georgia,serif;margin:8px 0 4px}
.listing>p{color:#6d655c;margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:24px}
button{font:inherit;cursor:pointer}
`;

const CLASSIC_CSS = `
.product{padding:16px max(16px,5vw)}
.breadcrumb{font-size:13px;color:#8a8178;margin-bottom:16px}
.product-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px}
.product-image{border-radius:10px;width:100%}
.product-title{font:400 36px/1.15 Georgia,serif;margin:0}
.rating{color:#8a8178;font-size:14px;margin:8px 0 20px}
.rating .stars{color:#c9a227}
.price{display:flex;align-items:baseline;gap:12px;margin:0 0 8px}
.price-now{font-size:30px;font-weight:600}
.price-was{color:#8a8178}
.sale-badge{background:#b3261e;color:#fff;font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px}
.stock{font-size:14px;color:#2f6b3a;margin:0 0 20px}
.stock.out{color:#b3261e}
.add-to-basket{background:#1d1b18;color:#fff;border:0;border-radius:8px;padding:14px 32px}
.add-to-basket:disabled{background:#c9c2b9;cursor:not-allowed}
.blurb{color:#4f4a44;max-width:44ch}
.details{font-size:13px;color:#8a8178;display:flex;gap:8px}
.details dd{margin:0}
.related{margin-top:56px}
.related h2{font:400 24px Georgia,serif}
.card{text-decoration:none}
.card-name{margin:10px 0 2px;font-size:15px}
.card-price{font-size:14px;color:#4f4a44}
@media (max-width:720px){.product-grid{grid-template-columns:1fr}}
`;

const REDESIGN_CSS = `
.site-header{background:#1d1b18;color:#fff;border:0}
.pdp{padding:0 0 16px}
.pdp__hero{background:#ede6dc;display:flex;justify-content:center;max-height:440px;overflow:hidden}
.pdp__hero img{max-width:440px}
.pdp__head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:28px max(16px,5vw) 8px}
.pdp__name{font:400 40px/1.1 Georgia,serif;margin:0}
.pdp__rating{color:#8a8178;font-size:14px}
.pdp__pricing{text-align:right}
.pdp__amount{font-size:44px;font-weight:600;line-height:1}
.pdp__amount.is-sale{color:#b3261e}
.pdp__was{display:block;color:#8a8178;font-size:14px;margin-top:6px}
.pdp__stock,.pdp__copy{padding:0 max(16px,5vw);color:#4f4a44}
.pdp__cta{display:block;width:calc(100% - 2 * max(16px,5vw));margin:16px auto;background:#1d1b18;color:#fff;border:0;border-radius:8px;padding:16px}
.pdp__cta:disabled{background:#c9c2b9}
.pdp__related{padding:24px max(16px,5vw)}
.pdp__related h2{font:400 24px Georgia,serif}
.pdp__card{text-decoration:none}
.pdp__card-name{margin:10px 0 2px;font-size:15px}
.pdp__card-price{font-size:14px;color:#4f4a44}
`;

function modernCss(): string {
  const m = namer('modern');
  return `
.${m('page')}{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:48px;padding:32px max(16px,5vw)}
.${m('media')} img{border-radius:24px}
.${m('title')}{font:700 32px/1.1 ui-sans-serif,system-ui;letter-spacing:-.02em;margin:0 0 16px}
.${m('price')}{font-size:34px;font-weight:700;min-height:44px}
.${m('was')},.${m('stock')}{color:#8a8178;font-size:14px;min-height:21px}
.${m('cta')}{margin-top:24px;width:100%;background:#3b3bf2;color:#fff;border:0;border-radius:999px;padding:16px}
.${m('copy')}{color:#4f4a44}
.${m('related')}{grid-column:1/-1}
.${m('card')}{text-decoration:none}
.${m('card-name')}{margin:10px 0 2px;font-size:15px}
.${m('card-price')}{font-size:14px;color:#4f4a44}
@media (max-width:720px){.${m('page')}{grid-template-columns:1fr}}
`;
}

const LAYOUT_CSS: Record<Layout, string> = {
  classic: CLASSIC_CSS,
  redesign: REDESIGN_CSS,
  modern: modernCss(),
};

interface ShellProps {
  shop: ShopName;
  layout: Layout;
  title: string;
  description?: string;
  head?: Html;
  body: Html;
}

export function shell({ shop, layout, title, description, head, body }: ShellProps): string {
  return html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · ${shop}</title>
        ${description ? html`<meta name="description" content="${description}" />` : ''}
        <style>
          ${raw(BASE_CSS + LAYOUT_CSS[layout])}
        </style>
        ${head ?? ''}
      </head>
      <body>
        <p class="practice">
          A practice shop for testing price monitors. Nothing here is for sale.
        </p>
        <header class="site-header">
          <a class="logo" href="/">${shop}</a>
          <nav>
            <a href="/c/kitchen">Kitchen</a>
            <a href="/c/desk">Desk</a>
            <a href="/c/home">Home</a>
          </nav>
        </header>
        ${body}
        <footer class="site-footer">${shop} · ${SHOPS[shop].tagline}</footer>
      </body>
    </html>`.value;
}
