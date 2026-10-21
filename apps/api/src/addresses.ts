import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicAddress } from '@pennydrop/fetch';

/** Every address a name resolves to. */
export type Lookup = (hostname: string) => Promise<string[]>;

export const systemLookup: Lookup = async (hostname) =>
  (await dnsLookup(hostname, { all: true })).map((entry) => entry.address);

const LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Refuses an address inside a private network before it's saved. This is the
 * friendly early answer, not the defence: the fetcher checks every address it
 * actually connects to, after every redirect.
 */
export async function isPrivateHost(
  hostname: string,
  { localShops, lookup }: { localShops: boolean; lookup: Lookup },
): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    // In development the practice shops live at fickle.localhost and friends.
    return !(localShops && host.endsWith('.localhost'));
  }
  if (isIP(host)) return !isPublicAddress(host);
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS).unref(),
    );
    const addresses = await Promise.race([lookup(host), timeout]);
    return addresses.some((address) => !isPublicAddress(address));
  } catch {
    // It doesn't resolve right now. It can still be saved; its checks will say what's wrong.
    return false;
  }
}
