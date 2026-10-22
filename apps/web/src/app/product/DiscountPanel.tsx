import type { DiscountCheck } from '@pennydrop/domain';
import { useEffect, useState } from 'react';
import { discountWords, percentOff } from '../../lib/discount.ts';
import { formatMoney } from '../../lib/money.ts';

const TONE = {
  honest: { chip: 'border-verdigris/50 text-verdigris-deep', bar: 'bg-verdigris' },
  inflated: { chip: 'border-copper/60 text-copper-deep', bar: 'bg-copper' },
  too_soon: { chip: 'border-line text-ink-2', bar: 'bg-ink-2' },
} as const;

/**
 * The honest-discount check: the discount the shop claims, then the one we
 * saw. The second bar starts at the claim's length and settles at the truth.
 */
export function DiscountPanel({
  check,
  day,
}: {
  check: DiscountCheck;
  day: (t: number) => string;
}) {
  const { was, price, currency, lowestBefore, verdict } = check;
  const words = discountWords(check, day);
  const tone = TONE[verdict];
  // Both bars on one scale: from the price now up to the higher of the two "before" prices.
  const top = Math.max(was, lowestBefore ?? was);
  const width = (before: number) => `${(Math.max(before - price, 0) / (top - price || 1)) * 100}%`;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section aria-labelledby="discount" className="rounded-[14px] border border-line p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="discount" className="text-[15px] font-semibold">
          Is the discount real?
        </h2>
        <span className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${tone.chip}`}>
          {words.title}
        </span>
      </div>
      <p className="mt-3 max-w-[62ch] text-sm leading-6">{words.text}</p>

      <dl className="tabular mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-[12px]">
        <dt className="text-ink-2">The shop says</dt>
        <dd className="flex items-center gap-3">
          <span
            className="h-2.5 rounded-full border border-ink-2/40 bg-[repeating-linear-gradient(135deg,var(--line)_0_4px,transparent_4px_8px)]"
            style={{ width: width(was) }}
            aria-hidden="true"
          />
          <span className="whitespace-nowrap">
            <s className="text-ink-2">{formatMoney(was, currency)}</s> {percentOff(was, price)}% off
          </span>
        </dd>
        {lowestBefore !== null && (
          <>
            <dt className="text-ink-2">We saw</dt>
            <dd className="flex items-center gap-3">
              <span
                className={`h-2.5 rounded-full transition-[width] delay-300 duration-[1100ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${tone.bar}`}
                style={{ width: width(settled ? lowestBefore : was) }}
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">
                {formatMoney(lowestBefore, currency)}{' '}
                {price < lowestBefore ? `${percentOff(lowestBefore, price)}% off` : 'no discount'}
              </span>
            </dd>
          </>
        )}
      </dl>
      <p className="mt-5 text-[12px] text-ink-2">
        In the EU, a sale’s “was” price must be the lowest price of the 30 days before it (Directive
        2019/2161).
      </p>
    </section>
  );
}
