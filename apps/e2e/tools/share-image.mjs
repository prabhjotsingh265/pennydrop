// The link-preview image, apps/web/public/share.png: drawn from HTML in the brand's own fonts and
// colours, at the 1200 × 630 Open Graph previews use. make share-image draws it again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const font = (name) =>
  readFileSync(
    `${root}apps/web/node_modules/@fontsource-variable/${name}/files/${name}-latin-wdth-normal.woff2`,
  ).toString('base64');

const html = `<!doctype html>
<html><head><style>
  @font-face { font-family: Mona; src: url(data:font/woff2;base64,${font('mona-sans')}) format('woff2');
    font-weight: 200 900; font-stretch: 75% 125%; }
  @font-face { font-family: Martian; src: url(data:font/woff2;base64,${font('martian-mono')}) format('woff2');
    font-weight: 100 800; font-stretch: 75% 112.5%; }
  :root { --paper: oklch(0.975 0.007 75); --ink: oklch(0.235 0.022 225); --ink-2: oklch(0.47 0.02 225);
    --copper: oklch(0.68 0.135 55); --copper-deep: oklch(0.47 0.125 45); --on-copper: oklch(0.235 0.022 225); }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: var(--paper); color: var(--ink); font-family: Mona;
    padding: 64px 72px; position: relative; overflow: hidden; }
  .brand { display: flex; align-items: center; gap: 14px; font-weight: 620; font-size: 30px; letter-spacing: -0.01em; }
  h1 { margin-top: 46px; font-size: 118px; line-height: 0.9; font-weight: 760; font-stretch: 112%;
    letter-spacing: -0.035em; }
  .line { position: absolute; left: 72px; right: 72px; top: 452px; height: 4px; }
  .tagline { position: absolute; left: 72px; bottom: 58px; font-size: 27px; line-height: 1.35; color: var(--ink-2);
    max-width: 760px; }
  .target { position: absolute; right: 72px; top: 412px; font-family: Martian; font-size: 17px; color: var(--copper-deep); }
</style></head><body>
  <div class="brand">
    <svg width="44" height="44" viewBox="0 0 48 48"><path d="M3 24h11M34 24h11" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
      <circle cx="24" cy="24" r="9.5" fill="var(--copper)"/><circle cx="24" cy="24" r="6.2" fill="none" stroke="var(--on-copper)" stroke-opacity=".35" stroke-width="1.5"/></svg>
    Pennydrop
  </div>
  <h1>Know when the<br>penny drops.</h1>
  <div class="target">target £38.00</div>
  <svg class="line" style="height: 120px; top: 392px" viewBox="0 0 1056 120" preserveAspectRatio="none">
    <path d="M0 62H770M846 62H1056" stroke="var(--copper)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="770" cy="62" r="6" fill="var(--copper)"/><circle cx="846" cy="62" r="6" fill="var(--copper)"/>
    <circle cx="808" cy="80" r="34" fill="var(--copper)"/>
    <circle cx="808" cy="80" r="22" fill="none" stroke="var(--on-copper)" stroke-opacity=".35" stroke-width="3"/>
  </svg>
  <p class="tagline">Price monitoring that notices when a shop redesigns its page, and keeps going.</p>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
// The fonts are data, but still load before they draw.
await page.evaluate('document.fonts.ready');
await page.screenshot({ path: `${root}apps/web/public/share.png` });
await browser.close();
console.log('apps/web/public/share.png');
