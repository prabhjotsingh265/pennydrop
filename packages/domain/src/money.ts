const digitsCache = new Map<string, number>();

/** Digits after the decimal point: 2 for GBP, 0 for JPY, 3 for KWD. */
export function minorDigits(currency: string): number {
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

/**
 * A price someone typed ("35", "£35.00", "1,299.99") as whole minor units.
 * People type prices for themselves, so this is forgiving: currency symbols
 * and thousands commas are ignored, and the last "." or "," is the decimal point
 * when one or two digits follow it.
 */
export function minorUnitsFrom(text: string, currency: string): number | null {
  const plain = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(plain)) return null;
  const decimal = /[.,](\d{1,2})$/.exec(plain);
  const whole = (decimal ? plain.slice(0, decimal.index) : plain).replace(/\D/g, '');
  const units = Number(`${whole || '0'}.${decimal?.[1] ?? '0'}`);
  const minor = Math.round(units * 10 ** minorDigits(currency));
  return minor > 0 ? minor : null;
}

export function formatMoney(minor: number, currency: string, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    minor / 10 ** minorDigits(currency),
  );
}
