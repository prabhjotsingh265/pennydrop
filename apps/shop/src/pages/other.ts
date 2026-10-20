import { html, raw } from '../html.ts';
import type { ShopName, ShopSettings } from '../settings.ts';
import { tile, type Listed } from './product.ts';
import { shell } from './shell.ts';

export function listingPage(
  shop: ShopName,
  settings: ShopSettings,
  title: string,
  intro: string,
  items: Listed[],
): string {
  return shell({
    shop,
    layout: settings.layout,
    title,
    description: intro,
    body: html`<main class="listing">
      <h1>${title}</h1>
      <p>${intro}</p>
      <div class="grid">${items.map((item) => tile(settings.layout, item))}</div>
    </main>`,
  });
}

export function notFoundPage(shop: ShopName, settings: ShopSettings): string {
  return shell({
    shop,
    layout: settings.layout,
    title: 'Not found',
    body: html`<main class="listing">
      <h1>We couldn't find that page</h1>
      <p>It may have sold out for good. <a href="/">Back to the shop</a>.</p>
    </main>`,
  });
}

export function serverErrorPage(): string {
  return html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <title>Something went wrong</title>
      </head>
      <body style="font:16px system-ui;padding:40px">
        <h1>Something went wrong on our side</h1>
        <p>Please try again in a few minutes.</p>
      </body>
    </html>`.value;
}

export function tooManyRequestsPage(seconds: number): string {
  return html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <title>Too many requests</title>
      </head>
      <body style="font:16px system-ui;padding:40px">
        <h1>Too many requests</h1>
        <p>Please wait ${seconds} seconds and try again.</p>
      </body>
    </html>`.value;
}

/** What a firewall's "you look like a bot" page tends to look like. */
export function blockedPage(reference: string): string {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Access denied</title>
      </head>
      <body style="font:15px system-ui;padding:60px;max-width:640px;margin:auto;color:#333">
        <h1 style="font-size:22px">Access denied</h1>
        <p>We've noticed unusual traffic from your network, so this request was blocked.</p>
        <p style="color:#888;font-size:13px">Reference #${reference}</p>
      </body>
    </html>`.value;
}

const FIELDS: [keyof ShopSettings, string][] = [
  ['layout', 'Page layout'],
  ['jsonLd', 'JSON-LD'],
  ['microdata', 'Microdata'],
  ['metaTags', 'Price meta tags'],
  ['stock', 'Stock'],
  ['sale', 'Sale'],
  ['errorRate', 'Share answered 500'],
  ['rateLimitRate', 'Share answered 429'],
  ['blockRate', 'Share answered 403'],
  ['crawlDelay', 'Crawl-delay (seconds)'],
];

const OPTIONS: Partial<Record<keyof ShopSettings, string[]>> = {
  layout: ['classic', 'redesign', 'modern'],
  stock: ['auto', 'in', 'out'],
  sale: ['auto', 'on', 'off'],
};

/** The controls that make the shop misbehave on purpose. A tool, so it's plain. */
export function chaosPage(
  shop: ShopName,
  settings: ShopSettings,
  token: string | undefined,
): string {
  const field = ([key, label]: [keyof ShopSettings, string]) => {
    const value = settings[key];
    const options = OPTIONS[key];
    let input;
    if (options) {
      input = html`<select name="${key}">
        ${options.map((o) => html`<option${o === value ? raw(' selected') : ''}>${o}</option>`)}
      </select>`;
    } else if (typeof value === 'boolean') {
      input = html`<input
        type="checkbox"
        name="${key}"
        value="true"
        ${value ? raw(' checked') : ''}
      />`;
    } else {
      input = html`<input type="number" name="${key}" value="${value}" step="any" min="0" />`;
    }
    return html`<label
      style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #eee"
      >${label} ${input}</label
    >`;
  };

  return html`<!doctype html>
    <html lang="en-GB">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Chaos · ${shop}</title>
      </head>
      <body style="font:15px system-ui;max-width:520px;margin:40px auto;padding:0 16px">
        <h1 style="font-size:22px">Chaos controls · ${shop}</h1>
        <p style="color:#666">These change ${shop} only, for everyone, until the shop restarts.</p>
        <form method="post">
          ${token ? html`<input type="hidden" name="token" value="${token}" />` : ''}
          ${FIELDS.map(field)}
          <label
            style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #eee"
            >Wait (ms), from
            <span
              ><input
                type="number"
                name="latencyMin"
                value="${settings.latencyMs[0]}"
                min="0"
                style="width:90px" />
              to
              <input
                type="number"
                name="latencyMax"
                value="${settings.latencyMs[1]}"
                min="0"
                style="width:90px" /></span
          ></label>
          <p>
            <button type="submit">Apply</button>
            <button type="submit" name="reset" value="true">Back to normal</button>
          </p>
        </form>
      </body>
    </html>`.value;
}
