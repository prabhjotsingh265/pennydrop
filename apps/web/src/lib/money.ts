import { formatMoney as format, minorDigits } from '@pennydrop/domain';

export { minorDigits };

/** Money is stored as whole minor units (pence, cents, paise). */
export function formatMoney(minor: number, currency = 'GBP', locale = 'en-GB'): string {
  return format(minor, currency, locale);
}
