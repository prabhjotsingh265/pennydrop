import { describe, expect, it } from 'vitest';
import { cleanUrl, siteOf } from './url.ts';

const clean = (input: string) => {
  const result = cleanUrl(input);
  return result.ok ? result.url : result.error;
};

describe('cleanUrl', () => {
  it('turns the same product, pasted different ways, into one address', () => {
    const forms = [
      'https://Fickle.Example.com/p/mug?utm_source=news&utm_medium=email#reviews',
      'fickle.example.com/p/mug',
      'https://fickle.example.com./p/mug?fbclid=abc123',
      'https://fickle.example.com:443/p/mug?gclid=x&ref=home',
    ];
    expect(new Set(forms.map(clean))).toEqual(new Set(['https://fickle.example.com/p/mug']));
  });

  it('keeps parameters that matter, sorted', () => {
    expect(clean('https://shop.example.com/p?size=large&colour=blue&utm_campaign=x')).toBe(
      'https://shop.example.com/p?colour=blue&size=large',
    );
  });

  it('refuses what isn’t a web page', () => {
    expect(clean('ftp://example.com/file')).toBe('not-http');
    expect(clean('javascript:alert(1)')).toBe('not-http');
    expect(clean('just some words')).toBe('not-a-url');
    expect(clean('https://user:secret@example.com/')).toBe('has-credentials');
  });

  it('reads a host and port without a scheme as an address, not a scheme', () => {
    expect(clean('shop.example.com:8443/p/mug')).toBe('https://shop.example.com:8443/p/mug');
    expect(clean('localhost:3000/p')).toBe('https://localhost:3000/p');
    expect(clean('mailto:someone@example.com')).toBe('not-http');
  });

  it('keeps IPv6 addresses, for the private-network check to judge', () => {
    expect(clean('http://[::1]:8080/p')).toBe('http://[::1]:8080/p');
  });

  it('allows the local practice shop', () => {
    expect(clean('http://fickle.localhost:4000/p/stoneware-mug')).toBe(
      'http://fickle.localhost:4000/p/stoneware-mug',
    );
  });
});

describe('siteOf', () => {
  it('finds the registrable domain', () => {
    expect(siteOf('www.shop.example.co.uk')).toBe('example.co.uk');
    expect(siteOf('books.toscrape.com')).toBe('toscrape.com');
  });
});
