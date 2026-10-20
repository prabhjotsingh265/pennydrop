const digitsCache = new Map<string, number>();

/** Digits after the decimal point: 2 for GBP, 0 for JPY, 3 for KWD. Unknown currencies get 2. */
export function minorDigits(currency: string | null): number {
  if (!currency) return 2;
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    try {
      digits =
        new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
          .maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
    digitsCache.set(currency, digits);
  }
  return digits;
}

export const CODES = new Set([
  'AED',
  'AUD',
  'BGN',
  'BHD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JOD',
  'JPY',
  'KRW',
  'KWD',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'OMR',
  'PHP',
  'PLN',
  'RON',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'USD',
  'VND',
  'ZAR',
]);

const DOLLARS = new Set(['USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'TWD', 'MXN']);
const KRONOR = new Set(['SEK', 'NOK', 'DKK', 'ISK']);
const YEN = new Set(['JPY', 'CNY']);

/**
 * Symbols, longest first so "US$" wins over "$". `null` means the symbol is
 * shared between currencies, and the page's other clues decide.
 */
export const SYMBOLS: [symbol: string, currency: string | null, family?: Set<string>][] = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['AU$', 'AUD'],
  ['NZ$', 'NZD'],
  ['HK$', 'HKD'],
  ['MX$', 'MXN'],
  ['NT$', 'TWD'],
  ['CN¥', 'CNY'],
  ['JP¥', 'JPY'],
  ['BR$', 'BRL'],
  ['R$', 'BRL'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
  ['S$', 'SGD'],
  ['Rs.', 'INR'],
  ['Rs', 'INR'],
  ['Fr.', 'CHF'],
  ['zł', 'PLN'],
  ['Kč', 'CZK'],
  ['Ft', 'HUF'],
  ['lei', 'RON'],
  ['Nkr', 'NOK'],
  ['Dkr', 'DKK'],
  ['Skr', 'SEK'],
  ['kr.', null, KRONOR],
  ['kr', null, KRONOR],
  ['元', 'CNY'],
  ['£', 'GBP'],
  ['€', 'EUR'],
  ['₹', 'INR'],
  ['₩', 'KRW'],
  ['₺', 'TRY'],
  ['₫', 'VND'],
  ['฿', 'THB'],
  ['₱', 'PHP'],
  ['₪', 'ILS'],
  ['¥', null, YEN],
  ['￥', null, YEN],
  ['$', null, DOLLARS],
];

/** For a shared symbol: the page's currency if it's in the family, otherwise the usual one. */
export function resolveShared(family: Set<string>, hint: string | null | undefined): string {
  if (hint && family.has(hint)) return hint;
  return [...family][0]!;
}
