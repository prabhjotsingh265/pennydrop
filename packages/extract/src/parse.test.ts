import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { minorDigits } from './currency.ts';
import { findPrices, parseAmount, parsePrice } from './parse.ts';

// [as written, hint, amount in minor units, currency]
const CASES: [string, string | null, number, string][] = [
  ['£46.50', null, 4650, 'GBP'],
  ['£1,299.99', null, 129999, 'GBP'],
  ['£1,299', null, 129900, 'GBP'],
  ['1.299,99 €', null, 129999, 'EUR'],
  ['1 299,99 €', null, 129999, 'EUR'],
  ['€12,50', null, 1250, 'EUR'],
  ['12,50 €', null, 1250, 'EUR'],
  ['€ 12,-', null, 1200, 'EUR'],
  ['1.234.567,89 €', null, 123456789, 'EUR'],
  ['$1,234,567.89', null, 123456789, 'USD'],
  ['₹1,29,999', null, 12999900, 'INR'],
  ['₹1,29,999.00', null, 12999900, 'INR'],
  ['Rs. 499', null, 49900, 'INR'],
  ['¥1299', null, 1299, 'JPY'],
  ['￥1,299', null, 1299, 'JPY'],
  ['¥1,299', 'CNY', 129900, 'CNY'],
  ["CHF 1'299.90", null, 129990, 'CHF'],
  ['1’299.90 CHF', null, 129990, 'CHF'],
  ['US$19.99', null, 1999, 'USD'],
  ['$19.99', null, 1999, 'USD'],
  ['$19.99', 'CAD', 1999, 'CAD'],
  ['A$ 49.95', null, 4995, 'AUD'],
  ['R$ 1.234,56', null, 123456, 'BRL'],
  ['1 299,00 zł', null, 129900, 'PLN'],
  ['99,00 kr', null, 9900, 'SEK'],
  ['99,00 kr', 'NOK', 9900, 'NOK'],
  ['KWD 12.500', null, 12500, 'KWD'],
  ['12,500 KWD', null, 12500, 'KWD'],
  ['EUR 12.50', null, 1250, 'EUR'],
  ['GBP46.50', null, 4650, 'GBP'],
  ['Price: £46.50 inc. VAT', null, 4650, 'GBP'],
  ['Pack of 3 £12.99', null, 1299, 'GBP'],
  ['5 for $20', null, 2000, 'USD'],
];

describe('parsePrice', () => {
  it.each(CASES)('reads %s', (text, hint, amount, currency) => {
    expect(parsePrice(text, { currency: hint })).toMatchObject({ amount, currency });
  });

  it.each([
    '350 ml',
    'Free delivery over 50',
    'Tax £0.00',
    '£12.3456',
    'Holds 300 ml.',
    'TEN pounds',
  ])('finds no price in %s', (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});

describe('findPrices', () => {
  it('finds every price in a sentence, in order', () => {
    expect(findPrices('Now £34.00, was £48.00').map((p) => p.amount)).toEqual([3400, 4800]);
    expect(findPrices('£10 – £15').map((p) => p.amount)).toEqual([1000, 1500]);
  });
});

describe('parseAmount', () => {
  it('reads the bare numbers structured data uses', () => {
    expect(parseAmount('46.50', 'GBP')).toBe(4650);
    expect(parseAmount(46.5, 'GBP')).toBe(4650);
    expect(parseAmount('1,299.00', 'USD')).toBe(129900);
    expect(parseAmount('1299', 'JPY')).toBe(1299);
    expect(parseAmount('12.500', 'KWD')).toBe(12500);
  });

  it('refuses anything that isn’t one positive number', () => {
    expect(parseAmount('', 'GBP')).toBeNull();
    expect(parseAmount('0', 'GBP')).toBeNull();
    expect(parseAmount('9.99 - 19.99', 'USD')).toBeNull();
    expect(parseAmount(null, 'GBP')).toBeNull();
  });
});

describe('every format the platform itself writes', () => {
  const LOCALES = [
    'en-GB',
    'en-US',
    'en-IN',
    'en-CA',
    'de-DE',
    'de-CH',
    'fr-FR',
    'es-ES',
    'it-IT',
    'nl-NL',
    'pl-PL',
    'sv-SE',
    'pt-BR',
    'ja-JP',
  ];
  const CURRENCIES = [
    'GBP',
    'EUR',
    'USD',
    'CAD',
    'INR',
    'JPY',
    'CHF',
    'PLN',
    'SEK',
    'NOK',
    'BRL',
    'KWD',
    'CNY',
  ];

  it('reads back exactly what Intl.NumberFormat wrote', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LOCALES),
        fc.constantFrom(...CURRENCIES),
        fc.integer({ min: 1, max: 999_999_999 }),
        (locale, currency, amount) => {
          const text = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
            amount / 10 ** minorDigits(currency),
          );
          const found = parsePrice(text, { currency });
          expect(found, text).toMatchObject({ amount, currency });
        },
      ),
      { numRuns: 3000 },
    );
  });
});
