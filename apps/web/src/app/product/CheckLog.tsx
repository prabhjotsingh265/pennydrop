import type { CheckSummary } from '@pennydrop/domain';
import { useState } from 'react';
import { Link } from 'react-router';
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

/** The waterfall's key: which colour is which step. */
export function TimingLegend() {
  return (
    <p className="tabular flex gap-3 text-[11px] text-ink-2">
      {SEGMENTS.map(({ key, label, className }) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${className}`} aria-hidden="true" />
          {label}
        </span>
      ))}
    </p>
  );
}

interface RowProps {
  check: CheckSummary;
  now: number;
  currency: string;
  moment: (t: number) => string;
  /** The longest check in view, so every bar shares one scale. */
  scale: number;
  /** In the workspace-wide log: which product it was, linked. */
  product?: { label: string; href: string };
}

/** One check: what came of it, when, and how long each step took. Click for the details. */
export function CheckRow({ check, now, currency, moment, scale, product }: RowProps) {
  const [open, setOpen] = useState(false);
  const at = Date.parse(check.startedAt);
  const good = isGoodOutcome(check.outcome);
  return (
    <li className={product ? 'pt-3' : ''}>
      {product && (
        <Link
          to={product.href}
          className="inline-flex min-h-6 items-center text-sm font-medium hover:text-copper-deep"
        >
          {product.label}
        </Link>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-left ${
          product ? 'pt-1 pb-3' : 'py-3'
        }`}
      >
        <span className="min-w-0">
          {/* Leaving a struggling shop alone is a choice, not a failure: grey, not red. */}
          <span
            className={`text-sm ${
              good ? '' : check.outcome === 'skipped_breaker_open' ? 'text-ink-2' : 'text-danger'
            }`}
          >
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
            {check.mode && ` · ${check.mode === 'browser' ? 'in a browser' : 'plain HTTP'}`}
            {check.reason !== 'scheduled' && ` · ${check.reason}`}
          </span>
        </span>
        <span className="tabular text-[11px] text-ink-2">
          {check.timings?.total ? ms(check.timings.total) : '—'}
        </span>
        {check.timings?.total ? (
          <span className="col-span-2">
            <Waterfall timings={check.timings} scale={scale} />
          </span>
        ) : null}
      </button>
      {open && (
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
                {check.confidence !== null && `, ${Math.round(check.confidence * 100)}% sure`}
              </dd>
            </>
          )}
          {check.screenshot && (
            <div className="col-span-2 mt-2">
              <a
                href={`/api/checks/${check.id}/screenshot`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-fit"
              >
                <img
                  src={`/api/checks/${check.id}/screenshot`}
                  alt="The page as this check saw it"
                  loading="lazy"
                  className="max-h-64 rounded-[8px] border border-line"
                />
                <span className="mt-1 block font-sans text-[12px] text-copper-deep underline">
                  Open the screenshot (kept for 7 days)
                </span>
              </a>
            </div>
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
}

/** The longest check among these: the scale every bar is drawn against. */
export const timingScale = (checks: CheckSummary[]) =>
  Math.max(1, ...checks.map((check) => check.timings?.total ?? 0));

/** Every recent check of one product, with how long each step took. */
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
  const [all, setAll] = useState(false);
  const shown = all ? checks : checks.slice(0, SHOWN);
  const scale = timingScale(checks);

  return (
    <section aria-labelledby="checks">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="checks" className="text-[15px] font-semibold">
          Checks
        </h2>
        <TimingLegend />
      </div>
      {checks.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">The first check is on its way.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {shown.map((check) => (
            <CheckRow
              key={check.id}
              check={check}
              now={now}
              currency={currency}
              moment={moment}
              scale={scale}
            />
          ))}
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
