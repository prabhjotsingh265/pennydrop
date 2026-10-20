import { describe, expect, it } from 'vitest';
import {
  ROBOTS_LIMIT,
  ROBOTS_TTL,
  isFresh,
  robotsRecord,
  robotsUrl,
  robotsVerdict,
} from './robots.ts';

const UA = 'PennydropBot';
const SHOP = 'https://fickle.example.com';
// What the practice shop and web-scraping.dev publish.
const FICKLE = 'User-agent: *\nCrawl-delay: 1\nDisallow: /clearance/\nDisallow: /basket\n';
const SCRAPING_DEV = 'User-agent: *\nDisallow: /robots-disallowed\nCrawl-delay: 2\n';

describe('robots.txt', () => {
  it('lives at the root of the site', () => {
    expect(robotsUrl(`${SHOP}/p/mug?x=1`)).toBe(`${SHOP}/robots.txt`);
  });

  it('allows what it doesn’t disallow, and passes on the crawl delay', () => {
    const record = robotsRecord(200, FICKLE, 0);
    expect(robotsVerdict(record, `${SHOP}/p/mug`, UA)).toMatchObject({
      allowed: true,
      crawlDelay: 1,
    });
    expect(robotsVerdict(record, `${SHOP}/clearance/candles`, UA).allowed).toBe(false);
  });

  it('reads web-scraping.dev’s rules', () => {
    const record = robotsRecord(200, SCRAPING_DEV, 0);
    expect(robotsVerdict(record, 'https://web-scraping.dev/product/1', UA)).toMatchObject({
      allowed: true,
      crawlDelay: 2,
    });
    expect(robotsVerdict(record, 'https://web-scraping.dev/robots-disallowed', UA).allowed).toBe(
      false,
    );
  });

  it('follows a group written for Pennydrop over the general one', () => {
    const record = robotsRecord(
      200,
      'User-agent: *\nAllow: /\n\nUser-agent: PennydropBot\nDisallow: /\n',
      0,
    );
    expect(robotsVerdict(record, `${SHOP}/p/mug`, UA).allowed).toBe(false);
  });

  it('treats a missing robots.txt (4xx) as "everything allowed", per RFC 9309', () => {
    expect(robotsVerdict(robotsRecord(404, 'Not found', 0), `${SHOP}/p/mug`, UA).allowed).toBe(
      true,
    );
  });

  it('treats an unreachable robots.txt (5xx or no answer) as "nothing allowed", per RFC 9309', () => {
    expect(robotsVerdict(robotsRecord(503, '', 0), `${SHOP}/p/mug`, UA).allowed).toBe(false);
    expect(robotsVerdict(robotsRecord(null, '', 0), `${SHOP}/p/mug`, UA).allowed).toBe(false);
  });

  it('keeps only the first 500 KiB, and a copy for a day', () => {
    expect(robotsRecord(200, 'x'.repeat(ROBOTS_LIMIT + 10), 0).body.length).toBe(ROBOTS_LIMIT);
    const record = robotsRecord(200, FICKLE, 1000);
    expect(isFresh(record, 1000 + ROBOTS_TTL - 1)).toBe(true);
    expect(isFresh(record, 1000 + ROBOTS_TTL)).toBe(false);
  });
});
