import type { Db, Site } from '@pennydrop/db';
import { cleanUrl, siteOf } from '@pennydrop/fetch';
import { isPrivateHost, type Lookup } from './addresses.ts';

export type Vetted =
  { ok: true; url: string; site: Site } | { ok: false; field: 'url'; error: string };

export interface VetDeps {
  db: Db;
  /** Development: allow the practice shops at *.localhost. */
  localShops: boolean;
  lookup: Lookup;
}

const URL_ERRORS = {
  'not-a-url': 'That doesn’t look like a product page address.',
  'not-http': 'That doesn’t look like a product page address.',
  'has-credentials': 'Addresses with a username or password in them can’t be checked.',
} as const;

/**
 * Everything that must hold before a page is previewed or watched: a real web
 * address, outside private networks, on a shop that allows automated checks
 * (and, in the demo, one of the practice shops). Records the site if it's new.
 */
export async function vetAddress(
  deps: VetDeps,
  workspace: { isDemo: boolean },
  address: string,
): Promise<Vetted> {
  const refuse = (error: string): Vetted => ({ ok: false, field: 'url', error });
  const clean = cleanUrl(address);
  if (!clean.ok) return refuse(URL_ERRORS[clean.error]);
  const hostname = new URL(clean.url).hostname;
  if (await isPrivateHost(hostname, deps)) {
    return refuse('We can’t check addresses inside private networks.');
  }

  const site = await deps.db.site.upsert({
    where: { host: hostname },
    update: {},
    create: {
      host: hostname,
      registrable: siteOf(hostname),
      demoAllowed: deps.localShops && hostname.endsWith('.localhost'),
    },
  });
  if (site.policy === 'api_only') {
    return refuse('This shop doesn’t allow automated checks. It offers an API instead.');
  }
  if (site.policy === 'blocked') return refuse('This shop doesn’t allow automated checks.');
  if (workspace.isDemo && !site.demoAllowed) {
    return refuse(
      'The demo only checks the practice shops. Run Pennydrop yourself to track anything.',
    );
  }
  return { ok: true, url: clean.url, site };
}
