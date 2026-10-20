const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, locale: string) {
  const key = `${locale}:${currency}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatters.set(key, found);
  }
  return found;
}

/** Digits after the decimal point for a currency: 2 for GBP, 0 for JPY, 3 for KWD. */
export function minorDigits(currency: string): number {
  return formatter(currency, 'en-GB').resolvedOptions().maximumFractionDigits ?? 2;
}

/** Money is stored as whole minor units (pence, cents, paise). */
export function formatMoney(minor: number, currency = 'GBP', locale = 'en-GB'): string {
  return formatter(currency, locale).format(minor / 10 ** minorDigits(currency));
}
