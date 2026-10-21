import type { CheckSummary } from '@pennydrop/domain';
import { useState } from 'react';
import { isGoodOutcome, outcomeWords } from '../../lib/events.ts';
import { formatMoney } from '../../lib/money.ts';
import { ago } from '../../lib/time.ts';

/** The most recent few; the rest are a click away. */
const SHOWN = 8;

const SEGMENTS = [
  { key: 'robots', label: 'robots.txt', className: 'bg-verdigris' },
  { key: 'http', label: 'page', className: 'bg-ink' },
  { key: 'browser', label: 'browser', className: 'bg-copper' },
] as const;

function ms(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/** One check's time, step by step, on a scale shared by every row. */
function Waterfall({ timings, scale }: { timings: Record<string, number>; scale: number }) {
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-line/50" aria-hidden="true">
      {SEGMENTS.map(({ key, className }) => {
        const value = timings[key] ?? 0;
        return value > 0 ? (
          <span key={key} className={className} style={{ width: `${(value / scale) * 100}%` }} />
        ) : null;
      })}
    </div>
  );
}

/** Every recent check, with how long each step took. */
export function CheckLog({
  checks,
  now,
  currency,
  moment,
}: {
  checks: CheckSummary[];
  now: number;
  currency: string;
  moment: (t: number) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? checks : checks.slice(0, SHOWN);
  const scale = Math.max(1, ...checks.map((check) => check.timings?.total ?? 0));

  return (
    <section aria-labelledby="checks">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="checks" className="text-[15px] font-semibold">
          Checks
        </h2>
        <p className="tabular flex gap-3 text-[11px] text-ink-2">
          {SEGMENTS.map(({ key, label, className }) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${className}`} aria-hidden="true" />
              {label}
            </span>
          ))}
        </p>
      </div>
      {checks.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">The first check is on its way.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {shown.map((check) => {
            const at = Date.parse(check.startedAt);
            const good = isGoodOutcome(check.outcome);
            const expanded = open === check.id;
            return (
              <li key={check.id}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : check.id)}
                  aria-expanded={expanded}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className={`text-sm ${good ? '' : 'text-danger'}`}>
                      {outcomeWords(check.outcome)}
                    </span>
                    {check.price !== null && (
                      <span className="tabular ml-2 text-sm">
                        {formatMoney(check.price, check.currency ?? currency)}
                      </span>
                    )}
                    <span className="tabular block text-[11px] text-ink-2">
                      <time dateTime={check.startedAt} title={moment(at)}>
                        {ago(now - at)}
                      </time>
                      {check.mode &&
                        ` · ${check.mode === 'browser' ? 'in a browser' : 'plain HTTP'}`}
                      {check.reason !== 'scheduled' && ` · ${check.reason}`}
                    </span>
                  </span>
                  <span className="tabular text-[11px] text-ink-2">
                    {check.timings?.total ? ms(check.timings.total) : '—'}
                  </span>
                  {check.timings && (
                    <span className="col-span-2">
                      <Waterfall timings={check.timings} scale={scale} />
                    </span>
                  )}
                </button>
                {expanded && (
                  <dl className="tabular mb-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-[8px] bg-surface p-3 text-[12px]">
                    {check.detail && (
                      <>
                        <dt className="text-ink-2">What happened</dt>
                        <dd className="font-sans text-[13px]">{check.detail}</dd>
                      </>
                    )}
                    {check.httpStatus !== null && (
                      <>
                        <dt className="text-ink-2">Answer</dt>
                        <dd>{check.httpStatus}</dd>
                      </>
                    )}
                    {check.strategy && (
                      <>
                        <dt className="text-ink-2">Read by</dt>
                        <dd>
                          {check.strategy}
                          {check.confidence !== null &&
                            `, ${Math.round(check.confidence * 100)}% sure`}
                        </dd>
                      </>
                    )}
                    {SEGMENTS.map(({ key, label }) =>
                      check.timings?.[key] ? (
                        <div key={key} className="contents">
                          <dt className="text-ink-2">{label}</dt>
                          <dd>{ms(check.timings[key])}</dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {checks.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-3 text-sm text-copper-deep underline"
        >
          {all ? 'Show fewer' : `Show all ${checks.length}`}
        </button>
      )}
    </section>
  );
}
