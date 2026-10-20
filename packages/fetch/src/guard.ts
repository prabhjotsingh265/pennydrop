import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

// Addresses no product page lives at: private networks, loopback, link-local
// (including the cloud metadata address 169.254.169.254), and reserved ranges.
const IPV4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

// IPv4 written inside IPv6 (::ffff:7f00:1 is 127.0.0.1) is blocked outright,
// along with NAT64, 6to4, unique-local, link-local and multicast.
const IPV6: [string, number][] = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

// Two lists, one per family: a single BlockList also checks IPv4 addresses
// against IPv6 rules as if they were written ::ffff:a.b.c.d, so blocking that
// range in a shared list would block every IPv4 address there is.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of IPV4) blockedV4.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6) blockedV6.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const plain = address.replace(/^\[|\]$/g, '');
  const family = isIP(plain);
  if (family === 4) return !blockedV4.check(plain, 'ipv4');
  if (family === 6) return !blockedV6.check(plain, 'ipv6');
  return false;
}

export interface GuardOptions {
  /** Hostnames allowed to reach private addresses and other ports: the practice shop, locally. */
  allowPrivate?: (hostname: string) => boolean;
  /** Development only: look this hostname up as another (fickle.localhost as the shop container). */
  resolveAs?: (hostname: string) => string | undefined;
  /** A stand-in for DNS, for tests. */
  resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>;
}

export class BlockedAddressError extends Error {
  readonly code = 'blocked-address';
  readonly hostname: string;
  readonly address: string;
  constructor(hostname: string, address: string) {
    super(`${hostname} resolves to ${address}, which isn't a public address.`);
    this.hostname = hostname;
    this.address = address;
  }
}

type LookupCallback = (error: Error | null, address?: unknown, family?: number) => void;

/**
 * A DNS lookup for the connection itself. Every address the name resolves to
 * must be public, and the connection then goes to exactly the address that
 * was checked: a name can't answer "public" to the check and "private" to the
 * connection a moment later (DNS rebinding).
 */
export function guardedLookup(options: GuardOptions, onResolved?: (ms: number) => void) {
  return (hostname: string, lookupOptions: { all?: boolean }, callback: LookupCallback) => {
    const started = performance.now();
    const name = options.resolveAs?.(hostname) ?? hostname;
    const resolve =
      options.resolve ?? ((host: string) => dnsLookup(host, { all: true, verbatim: true }));

    resolve(name).then(
      (addresses) => {
        onResolved?.(performance.now() - started);
        const first = addresses[0];
        if (!first)
          return callback(
            Object.assign(new Error(`No address for ${hostname}`), { code: 'ENOTFOUND' }),
          );
        if (!options.allowPrivate?.(hostname)) {
          const bad = addresses.find((a) => !isPublicAddress(a.address));
          if (bad) return callback(new BlockedAddressError(hostname, bad.address));
        }
        if (lookupOptions.all) callback(null, addresses);
        else callback(null, first.address, first.family);
      },
      (error: Error) => callback(error),
    );
  };
}
