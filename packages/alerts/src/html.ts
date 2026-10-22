/**
 * Every email Pennydrop sends, as HTML: one narrow column, tables and inline
 * styles (what mail apps reliably keep), and a dark version for the apps that
 * honour `prefers-color-scheme`. Every value is escaped: a product's label
 * comes from a shop's page.
 */

// The app's design tokens, in the hex mail apps understand (light, then dark).
const LIGHT = {
  paper: '#faf6f2',
  surface: '#f3eee9',
  line: '#d1dbdf',
  ink: '#122026',
  ink2: '#4f5d63',
  copper: '#d77f3d',
  copperDeep: '#9b471b',
  onCopper: '#122026',
};
const DARK = {
  paper: '#091216',
  surface: '#101b20',
  line: '#263338',
  ink: '#f2eee9',
  ink2: '#a4b0b5',
  copper: '#ee9b58',
  copperDeep: '#ee9b58',
  onCopper: '#091216',
};

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only web addresses become links; anything else is left as text. */
const safeHref = (href: string) => (/^https?:\/\//i.test(href) ? escapeHtml(href) : '#');

export interface EmailParts {
  /** The line an inbox shows beside the subject. */
  preheader: string;
  heading: string;
  /** A big figure under the heading, such as the new price. */
  figure?: { value: string; note?: string };
  paragraphs?: string[];
  /** A list, such as the reasons an alert fired. */
  items?: string[];
  button?: { label: string; href: string };
  links?: { label: string; href: string }[];
  /** Small print: why this was sent. */
  footer: string;
}

export function emailHtml(parts: EmailParts): string {
  const c = LIGHT;
  const p = (text: string) =>
    `<p class="ink2" style="margin:0 0 14px;font:15px/1.55 ${SANS};color:${c.ink2}">${escapeHtml(text)}</p>`;
  const figure = parts.figure
    ? `<p class="ink" style="margin:4px 0 2px;font:600 34px/1.15 ${MONO};color:${c.ink};letter-spacing:-0.02em">${escapeHtml(parts.figure.value)}</p>${
        parts.figure.note
          ? `<p class="copper-deep" style="margin:0 0 18px;font:600 14px/1.4 ${SANS};color:${c.copperDeep}">${escapeHtml(parts.figure.note)}</p>`
          : ''
      }`
    : '';
  const items = parts.items?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px">${parts.items
        .map(
          (item) =>
            `<tr><td class="copper" style="padding:3px 10px 3px 0;vertical-align:top;font:15px/1.5 ${SANS};color:${c.copper}">&bull;</td><td class="ink" style="padding:3px 0;font:15px/1.5 ${SANS};color:${c.ink}">${escapeHtml(item)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const button = parts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px"><tr><td class="button" style="border-radius:8px;background:${c.copper}"><a href="${safeHref(parts.button.href)}" class="on-copper" style="display:inline-block;padding:11px 18px;font:600 15px/1 ${SANS};color:${c.onCopper};text-decoration:none">${escapeHtml(parts.button.label)}</a></td></tr></table>`
    : '';
  const links = parts.links?.length
    ? `<p style="margin:0 0 6px;font:14px/1.6 ${SANS}">${parts.links
        .map(
          (link) =>
            `<a href="${safeHref(link.href)}" class="copper-deep" style="color:${c.copperDeep};text-decoration:underline">${escapeHtml(link.label)}</a>`,
        )
        .join(' &nbsp;·&nbsp; ')}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(parts.heading)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .page { background: ${DARK.paper} !important; }
    .card { background: ${DARK.surface} !important; border-color: ${DARK.line} !important; }
    .ink { color: ${DARK.ink} !important; }
    .ink2 { color: ${DARK.ink2} !important; }
    .copper { color: ${DARK.copper} !important; }
    .copper-deep { color: ${DARK.copperDeep} !important; }
    .button { background: ${DARK.copper} !important; }
    .on-copper { color: ${DARK.onCopper} !important; }
    .rule { border-color: ${DARK.line} !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${c.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(parts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="page" style="background:${c.paper}">
<tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font:600 17px/1 ${SANS}" class="ink"><span class="copper" style="color:${c.copper}">&#9679;</span>&nbsp;<span class="ink" style="color:${c.ink}">Pennydrop</span></td></tr>
<tr><td class="card" style="background:${c.surface};border:1px solid ${c.line};border-radius:14px;padding:26px 24px">
<h1 class="ink" style="margin:0 0 10px;font:600 21px/1.3 ${SANS};color:${c.ink}">${escapeHtml(parts.heading)}</h1>
${figure}${(parts.paragraphs ?? []).map(p).join('')}${items}${button}${links}
</td></tr>
<tr><td class="ink2" style="padding:16px 4px 0;font:12px/1.5 ${SANS};color:${c.ink2}">${escapeHtml(parts.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
