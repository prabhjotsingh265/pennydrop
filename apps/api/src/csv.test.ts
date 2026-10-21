import { describe, expect, it } from 'vitest';
import { csv, csvCell, fileName } from './csv.ts';

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Bud vase, smoke glass')).toBe('"Bud vase, smoke glass"');
    expect(csvCell('The "good" kettle')).toBe('"The ""good"" kettle"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('never lets a spreadsheet run a name as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example.com")')).toBe(
      '"\'=HYPERLINK(""http://evil.example.com"")"',
    );
    expect(csvCell('+44 kettle')).toBe("'+44 kettle");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // Numbers are numbers, even negative ones.
    expect(csvCell(-3)).toBe('-3');
  });

  it('joins rows with CRLF, as spreadsheets expect', () => {
    expect(
      csv([
        ['a', 1],
        ['b', null],
      ]),
    ).toBe('a,1\r\nb,\r\n');
  });
});

describe('fileName', () => {
  it('turns a name into a safe file name', () => {
    expect(fileName('Oak serving board')).toBe('oak-serving-board');
    expect(fileName('Crème brûlée set / 2')).toBe('creme-brulee-set-2');
    expect(fileName('***')).toBe('product');
  });
});
