import { CODES, SYMBOLS, minorDigits, resolveShared } from './currency.ts';

export interface FoundPrice {
  /** Whole minor units: pence, cents, paise. */
  amount: number;
  currency: string | null;
  /** The text as written, symbol included. */
  raw: string;
  index: number;
}

export interface PriceHints {
  /** The currency the page says it uses, if it says. Settles "$" and "kr". */
  currency?: string | null;
}

// No-break, figure, narrow no-break and thin spaces: all read as a plain space.
const SPACES = /[\u00a0\u2007\u202f\u2009]/g;

// A run of digits and separators. A space or apostrophe only counts as a
// thousands separator when exactly three digits follow it, so "pack of 3 12.99"
// stays two numbers.
const NUMBER = /\d+(?:[ '’](?=\d{3}(?!\d))\d{3}|[.,]\d+)*/g;

/**
 * Splits "1.299,99", "1,299.99", "1 299,99", "1,29,999" or "1'299.90" into
 * whole units and a fraction. The last "." or "," is the decimal point when
 * the other one appears before it, or when it appears once with one or two
 * digits after it. Three digits after it is read as thousands, except for
 * currencies that really have three decimals.
 */
export function splitNumber(
  run: string,
  currency: string | null,
): { whole: string; fraction: string } | null {
  const marks = [...run.matchAll(/[.,]/g)];
  const last = marks[marks.length - 1];
  if (!last) return { whole: run.replace(/\D/g, ''), fraction: '' };

  const mark = last[0];
  const tail = run.slice(last.index + 1);
  const sameMarks = marks.filter((m) => m[0] === mark).length;
  const otherMarkFirst = marks.some((m) => m[0] !== mark);

  let decimal: boolean;
  if (otherMarkFirst) decimal = tail.length <= 3;
  else if (sameMarks > 1) decimal = false;
  else if (tail.length === 3) decimal = minorDigits(currency) === 3;
  else decimal = tail.length <= 3;

  if (!decimal) {
    // Thousands groups after the first must be two (Indian lakhs) or three digits.
    const groups = run.split(/[.,'’ ]/).slice(1);
    if (groups.some((g) => g.length !== 3 && g.length !== 2)) return null;
    return { whole: run.replace(/\D/g, ''), fraction: '' };
  }
  return { whole: run.slice(0, last.index).replace(/\D/g, ''), fraction: tail };
}

/** "46.50" with GBP is 4650 pence. Rounds anything past the currency's own decimals. */
export function toMinor(whole: string, fraction: string, currency: string | null): number {
  const digits = minorDigits(currency);
  const units = Number(`${whole || '0'}.${fraction || '0'}`);
  return Math.round(units * 10 ** digits);
}

/** A number with no symbol, from structured data: "46.50", 46.5, "1,299.00". */
export function parseAmount(value: unknown, currency: string | null): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0
      ? Math.round(value * 10 ** minorDigits(currency))
      : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.replace(SPACES, ' ').trim();
  const match = text.match(NUMBER);
  if (!match || match.length !== 1) return null;
  const parts = splitNumber(match[0], currency);
  if (!parts) return null;
  const amount = toMinor(parts.whole, parts.fraction, currency);
  return amount > 0 ? amount : null;
}

function isLetter(char: string | undefined): boolean {
  return char !== undefined && /\p{L}/u.test(char);
}

/** The currency written right before or right after a number, if any. */
function currencyAround(
  before: string,
  after: string,
  hints: PriceHints,
): string | null | undefined {
  const left = before.trimEnd();
  const right = after.trimStart();

  for (const [symbol, currency, family] of SYMBOLS) {
    const wordy = isLetter(symbol[0]);
    const prefix =
      left.endsWith(symbol) && !(wordy && isLetter(left[left.length - symbol.length - 1]));
    // A symbol with a number straight after it belongs to that number: in
    // "pack of 3 £12.99" the pound sign is 12.99's, not 3's.
    const suffix =
      right.startsWith(symbol) &&
      !(isLetter(symbol[symbol.length - 1]) && isLetter(right[symbol.length])) &&
      !/^\s?\d/.test(right.slice(symbol.length));
    if (prefix || suffix) return currency ?? resolveShared(family!, hints.currency);
  }

  const codeBefore = /(?:^|[^A-Za-z])([A-Z]{3})$/.exec(left)?.[1];
  if (codeBefore && CODES.has(codeBefore)) return codeBefore;
  const codeAfter = /^([A-Z]{3})(?![A-Za-z])/.exec(right)?.[1];
  if (codeAfter && CODES.has(codeAfter)) return codeAfter;

  return undefined;
}

/**
 * Every price written in a piece of text: a number with a currency symbol or
 * code right next to it. Bare numbers ("3 left", "350 ml") are not prices.
 */
export function findPrices(text: string, hints: PriceHints = {}): FoundPrice[] {
  const normal = text.replace(SPACES, ' ').replace(/\s+/g, ' ');
  const found: FoundPrice[] = [];

  for (const match of normal.matchAll(NUMBER)) {
    const start = match.index;
    const end = start + match[0].length;
    const currency = currencyAround(
      normal.slice(Math.max(0, start - 6), start),
      normal.slice(end, end + 6),
      hints,
    );
    if (currency === undefined) continue;
    const parts = splitNumber(match[0], currency);
    if (!parts) continue;
    const amount = toMinor(parts.whole, parts.fraction, currency);
    if (amount <= 0) continue;
    found.push({ amount, currency, raw: match[0], index: start });
  }
  return found;
}

export function parsePrice(text: string, hints: PriceHints = {}): FoundPrice | null {
  return findPrices(text, hints)[0] ?? null;
}
