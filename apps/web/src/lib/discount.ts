import type { DiscountCheck } from '@pennydrop/domain';
import { formatMoney } from './money.ts';

export const percentOff = (from: number, to: number) => Math.round(((from - to) / from) * 100);

/** The honest-discount check in words: a title, and what we saw. */
export function discountWords(
  check: DiscountCheck,
  day: (t: number) => string,
): { title: string; text: string } {
  const { was, price, lowestBefore, days, verdict } = check;
  const money = (value: number) => formatMoney(value, check.currency);
  const since = day(Date.parse(check.since));
  const claimed = percentOff(was, price);

  if (verdict === 'inflated' && lowestBefore !== null) {
    const seen = `In the 30 days before the sale began on ${since}, we saw it at ${money(lowestBefore)}${
      check.lowestAt ? ` (from ${day(Date.parse(check.lowestAt))})` : ''
    }.`;
    const against =
      price < lowestBefore
        ? `it’s ${percentOff(lowestBefore, price)}% off, not ${claimed}%.`
        : price === lowestBefore
          ? `it’s the same price, not ${claimed}% off.`
          : `it costs ${money(price - lowestBefore)} more, not ${claimed}% less.`;
    return { title: 'The “was” price is inflated', text: `${seen} Against that, ${against}` };
  }
  if (verdict === 'honest' && lowestBefore !== null) {
    return {
      title: 'The discount is real',
      text: `We never saw it below ${money(lowestBefore)} in the 30 days before the sale began on ${since}, so “was ${money(was)}” holds up: ${claimed}% off.`,
    };
  }
  if (lowestBefore === null) {
    return {
      title: 'Too soon to say',
      text: 'It was already on sale when we started watching, so we haven’t seen what it cost before.',
    };
  }
  const watched = days === 0 ? 'less than a day' : `${days} ${days === 1 ? 'day' : 'days'}`;
  return {
    title: 'Too soon to say',
    text: `We’d watched it for ${watched} before the sale began on ${since}, not 30. In that time it never went below ${money(lowestBefore)}.`,
  };
}
