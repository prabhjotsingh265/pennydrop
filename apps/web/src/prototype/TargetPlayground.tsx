import { useState } from 'react';
import { PriceDigits } from '../components/PriceDigits.tsx';
import { StepChart, type PricePoint } from '../components/StepChart.tsx';
import { formatMoney } from '../lib/money.ts';
import { useTheme } from '../lib/theme.ts';
import { distanceFromTarget, proximityTint } from '../lib/tint.ts';

const DAY = 86_400_000;
const START = Date.UTC(2026, 6, 23);
const dayLabel = (day: number) =>
  new Date(START + day * DAY).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const HISTORY: PricePoint[] = [
  { t: 0, price: 7200 },
  { t: 12, price: 6900 },
  { t: 25, price: 7100 },
  { t: 33, price: 6600 },
  { t: 47, price: 6400 },
  { t: 58, price: 6500 },
  { t: 66, price: 6200 },
];
const FIRST_NOW = 89;
/** What the next checks find, in order, three days apart. Loops. */
const NEXT_PRICES = [5900, 6100, 5400, 5600, 5100, 6300, 5800];

const STOPS = [
  { at: 0.3, label: '30% above' },
  { at: 0.15, label: '15%' },
  { at: 0.05, label: '5%' },
  { at: 0, label: 'Target' },
];

export function TargetPlayground() {
  const [theme] = useTheme();
  const [points, setPoints] = useState(HISTORY);
  const [now, setNow] = useState(FIRST_NOW);
  const [checks, setChecks] = useState(0);
  const [target, setTarget] = useState(5500);

  const price = points[points.length - 1]!.price;
  const distance = distanceFromTarget(price, target);
  const above = price - target;

  const nextCheck = () => {
    const next = NEXT_PRICES[checks % NEXT_PRICES.length]!;
    const t = now + 3;
    setPoints((list) => [...list, { t, price: next }]);
    setNow(t);
    setChecks((n) => n + 1);
  };

  // Where the current distance sits on the ramp: 30% above at the left, the target at the right.
  const marker = Math.min(Math.max(1 - distance / 0.3, 0), 1);
  const ramp = [0.3, 0.225, 0.15, 0.1, 0.05, 0.025, 0]
    .map((d, i, all) => `${proximityTint(d, theme)} ${(i / (all.length - 1)) * 100}%`)
    .join(', ');

  return (
    <div
      className="rounded-[18px] border border-line p-5 transition-[background-color] duration-700 sm:p-8"
      style={{ backgroundColor: proximityTint(distance, theme) }}
    >
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-lg font-medium">Brass desk lamp</div>
          <div className="tabular text-[11px] text-ink-2">
            fickle · every 6 hours · checked {dayLabel(now)}
          </div>
        </div>
        <div className="flex items-end gap-8">
          <div>
            <div className="tabular text-[11px] text-ink-2">Your target</div>
            <PriceDigits value={target} className="text-2xl font-medium text-copper-deep" />
          </div>
          <div className="text-right">
            <div className="tabular text-[11px] text-ink-2">Now</div>
            <PriceDigits value={price} className="text-[44px] leading-none font-medium" />
          </div>
        </div>
      </div>

      <p className="mt-3 text-[15px]" aria-live="polite">
        {above > 0 ? (
          <>
            <span className="tabular">{formatMoney(above)}</span> above your target.
          </>
        ) : (
          <span className="font-medium text-copper-deep">
            ↓ <span className="tabular">{formatMoney(-above)}</span> under your target. The penny's
            dropped.
          </span>
        )}
      </p>

      <div className="mt-4 -mx-2">
        <StepChart
          points={points}
          target={target}
          domain={[now - 89, now]}
          now={now}
          height={300}
          yDomain={[4800, 7400]}
          ticks={[now - 84, now - 56, now - 28, now]}
          tickLabel={dayLabel}
          onTargetChange={setTarget}
          label={`Brass desk lamp over 90 days, now ${formatMoney(price)}, target ${formatMoney(target)}`}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={nextCheck}
            className="rounded-[8px] bg-copper px-4 py-2.5 text-sm font-medium text-on-copper transition-transform active:scale-[0.97]"
          >
            Next check
          </button>
          <span className="text-[13px] text-ink-2">
            Drag the copper line, or focus it and use the arrow keys.
          </span>
        </div>

        <figure className="w-full max-w-[360px]">
          <div
            className="relative h-3 rounded-full border border-line"
            style={{ background: `linear-gradient(90deg, ${ramp})` }}
          >
            <span
              className="absolute -top-1.5 size-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-ink transition-[left] duration-500"
              style={{ left: `${marker * 100}%` }}
              aria-hidden="true"
            />
          </div>
          <figcaption className="tabular mt-1.5 flex justify-between text-[10px] text-ink-2">
            {STOPS.map((stop) => (
              <span key={stop.at}>{stop.label}</span>
            ))}
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
