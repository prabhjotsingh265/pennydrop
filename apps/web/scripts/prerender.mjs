// After the build: the public pages rendered to HTML (dist/pages), each with its own title,
// description and link-preview tags. The API serves them, putting its APP_URL where the
// placeholder is, and the app takes over once its code arrives.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ssr = `${root}node_modules/.prerender/prerender.js`;
const { render } = await import(ssr);

/** The API puts its own address here: the build doesn't know where it will be served. */
const APP_URL = '__APP_URL__';

const PAGES = [
  {
    path: '/',
    file: 'index',
    // As the page's own useTitle sets them.
    title: 'Pennydrop: price monitoring that keeps going',
    description:
      'Price monitoring that notices when a shop redesigns its page, and keeps going. Polite to every shop, alerts that don’t cry wolf, and a demo where you break a shop yourself.',
  },
  {
    path: '/bot',
    file: 'bot',
    title: 'Our crawler · Pennydrop',
    description:
      'PennydropBot reads the price of a product someone asked Pennydrop to watch. How it introduces itself, what it respects, and how to turn it away.',
  },
  {
    path: '/privacy',
    file: 'privacy',
    title: 'Privacy · Pennydrop',
    description:
      'What Pennydrop keeps to watch prices for you, for how long, and what it never does: nothing to sell, nothing that follows you around.',
  },
  {
    path: '/terms',
    file: 'terms',
    title: 'Terms · Pennydrop',
    description: 'The plain rules for using Pennydrop, a price monitor, in plain words.',
  },
];

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const template = readFileSync(`${root}dist/index.html`, 'utf8');
mkdirSync(`${root}dist/pages`, { recursive: true });
for (const page of PAGES) {
  const url = `${APP_URL}${page.path}`;
  const head = [
    `<title>${escape(page.title)}</title>`,
    `<meta name="description" content="${escape(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Pennydrop" />`,
    `<meta property="og:title" content="${escape(page.title)}" />`,
    `<meta property="og:description" content="${escape(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${APP_URL}/share.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Pennydrop: “Know when the penny drops.”, above a coin falling through a copper target line." />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
  const body = await render(page.path);
  const html = template
    .replace(/<title>[\s\S]*?<\/title>\s*<meta\s+name="description"[\s\S]*?\/>/, head)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  if (!html.includes(head) || !html.includes(body)) {
    throw new Error(`The template didn't take ${page.path}: index.html has changed shape.`);
  }
  writeFileSync(`${root}dist/pages/${page.file}.html`, html);
  console.log(`prerendered ${page.path}: ${Math.round(html.length / 1024)} KB`);
}
