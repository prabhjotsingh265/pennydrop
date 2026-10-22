import { describe, expect, it } from 'vitest';
import { csvRow, parseBulk } from './bulk.ts';

describe('csvRow', () => {
  it('keeps commas and quotes inside quoted cells', () => {
    expect(csvRow('a,"Bud vase, smoke glass","say ""hi"""')).toEqual([
      'a',
      'Bud vase, smoke glass',
      'say "hi"',
    ]);
  });
});

describe('parseBulk', () => {
  it('reads a pasted list, one address per line, skipping blanks and comments', () => {
    const parsed = parseBulk(
      'fickle.example.com/p/mug\n\n# later\nhttps://shop.example.com/x?ids=1,2\n',
    );
    expect(parsed.items).toEqual([
      { line: 1, url: 'fickle.example.com/p/mug' },
      // A comma in a pasted address doesn't split it.
      { line: 4, url: 'https://shop.example.com/x?ids=1,2' },
    ]);
    expect(parsed.problems).toEqual([]);
  });

  it('reads a CSV by its header, in any column order', () => {
    const parsed = parseBulk(
      'Label,Target,Address\n"Vase, smoke",£12.50,fickle.example.com/p/vase\n',
    );
    expect(parsed.items).toEqual([
      { line: 2, url: 'fickle.example.com/p/vase', targetPrice: 1250, label: 'Vase, smoke' },
    ]);
  });

  it('reads a CSV file without a header as address, target, label', () => {
    expect(parseBulk('fickle.example.com/p/mug,30,Mug', true).items).toEqual([
      { line: 1, url: 'fickle.example.com/p/mug', targetPrice: 3000, label: 'Mug' },
    ]);
  });

  it('points at the lines it can’t use', () => {
    const parsed = parseBulk('address,target\nfickle.example.com/p/mug,cheap\n,30\n');
    expect(parsed.items).toEqual([]);
    expect(parsed.problems).toEqual([
      { line: 2, error: '“cheap” doesn’t look like a price.' },
      { line: 3, error: 'No address on this line.' },
    ]);
  });

  it('says when there are more than one bulk add takes', () => {
    const text = Array.from({ length: 51 }, (_, i) => `fickle.example.com/p/${i}`).join('\n');
    expect(parseBulk(text).tooMany).toBe(true);
    expect(parseBulk('fickle.example.com/p/1').tooMany).toBe(false);
  });
});
