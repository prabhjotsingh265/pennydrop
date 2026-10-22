import { describe, expect, it } from 'vitest';
import { unzip } from '../test/unzip.ts';
import { zip } from './zip.ts';

describe('zip', () => {
  it('packs files that read back exactly, names in UTF-8 included', () => {
    const archive = zip([
      { name: 'products.csv', data: 'name,price\r\nKettle,64.99\r\n' },
      { name: 'crème.csv', data: 'a'.repeat(5_000) },
    ]);
    expect(unzip(archive)).toEqual({
      'products.csv': 'name,price\r\nKettle,64.99\r\n',
      'crème.csv': 'a'.repeat(5_000),
    });
    // Compressed: five thousand of one letter takes far less room.
    expect(archive.length).toBeLessThan(1_000);
  });
});
