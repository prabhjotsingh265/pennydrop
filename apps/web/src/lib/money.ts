import { formatMoney as format, minorDigits } from '@pennydrop/domain';

export { minorDigits };

/** Money is stored as whole minor units (pence, cents, paise). */
export function formatMoney(minor: number, currency = 'GBP', locale = 'en-GB'): string {
  return format(minor, currency, locale);
}

/**
 * Labels for a chart's price axis: whole units when the ticks are a unit or
 * more apart ("£65"), with the fraction when they're closer ("£64.50"), so no
 * two ticks ever read the same.
 */
export function axisFormatter(currency: string, ticks: readonly number[]) {
  const digits = minorDigits(currency);
  const step = ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : Number.POSITIVE_INFINITY;
  const whole = step >= 10 ** digits;
  const format = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: whole ? 0 : digits,
  });
  return (tick: number) => format.format(tick / 10 ** digits);
}
