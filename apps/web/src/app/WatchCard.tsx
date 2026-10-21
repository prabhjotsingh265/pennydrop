import type { WatchSummary } from '@pennydrop/domain';
import { Link } from 'react-router';
import { PriceDigits } from '../components/PriceDigits.tsx';
import { StepChart } from '../components/StepChart.tsx';
import { formatMoney } from '../lib/money.ts';
import { useTheme } from '../lib/theme.ts';
import { ago } from '../lib/time.ts';
import { patina, proximityTint } from '../lib/tint.ts';
import { distance, trouble, waiting } from '../lib/watchlist.ts';

const WINDOW_MS = 30 * 86_400_000;

/** One product: its price, how close it is to your target, and its last 30 days. */
export function WatchCard({ watch, now }: { watch: WatchSummary; now: number }) {
  const [theme] = useTheme();
  const currency = watch.currency ?? 'GBP';
  const away = distance(watch);
  const problem = trouble(watch);
  const lastGood = watch.lastSuccessAt ? Date.parse(watch.lastSuccessAt) : null;
  // Copper while fresh, verdigris once the reading is two intervals old.
  const age = lastGood === null ? null : (now - lastGood) / (watch.intervalSeconds * 1000);
  const points = watch.history.flatMap((p) =>
    p.price === null ? [] : [{ t: Date.parse(p.t), price: p.price }],
  );
  const above =
    watch.price !== null && watch.targetPrice !== null ? watch.price - watch.targetPrice : null;

  return (
    <Link
      to={`/app/p/${watch.id}`}
      data-card={watch.id}
      className="flex flex-col rounded-[14px] border border-line p-4 transition-[background-color,border-color] duration-700 hover:border-ink-2/50"
      style={{ backgroundColor: away === null ? 'var(--surface)' : proximityTint(away, theme) }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-medium">{watch.label}</h2>
          <div className="tabular truncate text-[10px] text-ink-2">{watch.host}</div>
        </div>
        {problem ? (
          <span className="tabular shrink-0 rounded-full border border-line bg-paper/70 px-2 py-0.5 text-[10px] text-ink-2">
            {problem}
          </span>
        ) : (
          lastGood !== null && (
            <span
              className="tabular inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper/60 px-2 py-0.5 text-[10px]"
              style={{ color: patina(age ?? 0) }}
              title="Copper when fresh, verdigris when stale"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: patina(age ?? 0) }}
                aria-hidden="true"
              />
              {ago(now - lastGood)}
            </span>
          )
        )}
      </div>

      <div className="mt-3 flex min-h-[30px] items-end justify-between gap-2">
        {watch.price !== null ? (
          <PriceDigits
            value={watch.price}
            currency={currency}
            className="text-[26px] leading-none font-medium"
          />
        ) : (
          <span className="text-[13px] text-ink-2">{waiting(watch)}</span>
        )}
        {watch.targetPrice !== null && (
          <div className="tabular text-right text-[10px] leading-4 text-ink-2">
            target {formatMoney(watch.targetPrice, currency)}
            {above !== null && (
              <>
                <br />
                {above > 0 ? (
                  <>{formatMoney(above, currency)} above</>
                ) : (
                  <span className="font-semibold text-copper-deep">
                    ↓ {formatMoney(-above, currency)} under
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="-mx-1 mt-2">
        {points.length ? (
          <StepChart
            compact
            points={points}
            target={watch.targetPrice}
            currency={currency}
            domain={[now - WINDOW_MS, now]}
            now={now}
            height={64}
            label={`${watch.label}: ${
              watch.price === null ? 'no price yet' : formatMoney(watch.price, currency)
            }${watch.targetPrice === null ? '' : `, target ${formatMoney(watch.targetPrice, currency)}`}`}
          />
        ) : (
          <div className="mx-1 h-16 border-b border-dashed border-line" aria-hidden="true" />
        )}
      </div>
    </Link>
  );
}
