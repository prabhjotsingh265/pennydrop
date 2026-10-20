import { getDomain } from 'tldts';

// Parameters that track where a visitor came from. They never change the product.
const TRACKING = [
  /^utm_/i,
  /^(fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|igshid|srsltid|mc_cid|mc_eid|_ga|_gl|ref|ref_src|referrer|spm|trk|cmpid|affid|aff_id|affiliate)$/i,
];

export type CleanUrlError = 'not-a-url' | 'not-http' | 'has-credentials';

export type CleanUrl =
  { ok: true; url: string; host: string; site: string } | { ok: false; error: CleanUrlError };

/**
 * One address per product, however it was pasted: a scheme added if missing,
 * the host lower-cased, tracking parameters and the #fragment removed, and the
 * remaining parameters sorted. The same product added twice then matches.
 */
export function cleanUrl(input: string): CleanUrl {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: 'not-a-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, error: 'not-http' };
  if (url.username || url.password) return { ok: false, error: 'has-credentials' };
  if (!url.hostname.includes('.') && url.hostname !== 'localhost')
    return { ok: false, error: 'not-a-url' };

  url.hostname = url.hostname.replace(/\.$/, '');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname === '') url.pathname = '/';

  return { ok: true, url: url.toString(), host: url.host, site: siteOf(url.hostname) };
}

/** The registrable domain: "shop.example.co.uk" for "www.shop.example.co.uk". */
export function siteOf(hostname: string): string {
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
}
