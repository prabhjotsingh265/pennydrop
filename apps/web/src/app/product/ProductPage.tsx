import type { WatchDetail } from '@pennydrop/domain';
import { ArrowLeft, ExternalLink, Pause, Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PriceDigits } from '../../components/PriceDigits.tsx';
import { StepChart } from '../../components/StepChart.tsx';
import { ApiError } from '../../lib/api.ts';
import {
  RANGES,
  defaultRange,
  extremes,
  rangeDomain,
  soldOutBands,
  stepPoints,
  timeTicks,
  type RangeKey,
} from '../../lib/chart.ts';
import { chartFlag } from '../../lib/events.ts';
import { formatMoney } from '../../lib/money.ts';
import { useChecks, useMe, useWatch, useWatchActions } from '../../lib/queries.ts';
import { ago, dateWords, every, targetStep, useNow } from '../../lib/time.ts';
import { patina } from '../../lib/tint.ts';
import { distanceWords, trouble, waiting } from '../../lib/watchlist.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { CheckLog } from './CheckLog.tsx';
import { Settings } from './Settings.tsx';
import { Timeline } from './Timeline.tsx';

/** After "check now", look every couple of seconds for this long. */
const EAGER_MS = 30_000;
/** A dragged target is saved once it has stayed put this long. */
const SETTLE_MS = 600;

function Product({
  id,
  detail,
  eager,
  onEager,
}: {
  id: string;
  detail: WatchDetail;
  eager: boolean;
  onEager: (on: boolean) => void;
}) {
  const { watch, events } = detail;
  const navigate = useNavigate();
  const me = useMe().data!;
  const words = dateWords(me.workspace.timezone);
  const checks = useChecks(id, eager);
  const actions = useWatchActions(id);
  const clock = useNow();
  const [range, setRange] = useState<RangeKey>(() => defaultRange(watch.history, Date.now()));
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const settle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  const currency = watch.currency ?? 'GBP';
  const points = stepPoints(watch.history);
  // A reading newer than the clock's last tick still belongs on the chart.
  const now = Math.max(clock, points.at(-1)?.t ?? 0, Date.parse(watch.lastCheckedAt ?? '') || 0);
  const target = dragTarget ?? watch.targetPrice;
  const domain = rangeDomain(range, watch.history, now);
  const span = extremes(points, domain);
  const problem = trouble(watch);
  const lastGood = watch.lastSuccessAt ? Date.parse(watch.lastSuccessAt) : null;
  const age = lastGood === null ? 0 : (now - lastGood) / (watch.intervalSeconds * 1000);
  const above = watch.price !== null && target !== null ? watch.price - target : null;
  const step = targetStep(watch.price ?? target ?? 0);

  const moveTarget = (price: number) => {
    setDragTarget(price);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      actions.update.mutate({ targetPrice: price }, { onSettled: () => setDragTarget(null) });
    }, SETTLE_MS);
  };

  const checkNow = () => {
    setNotice(null);
    actions.checkNow.mutate(undefined, {
      onSuccess: () => {
        onEager(true);
        window.setTimeout(() => onEager(false), EAGER_MS);
      },
      onError: (error) => setNotice(error.message),
    });
  };

  const togglePause = () =>
    actions.update.mutate(
      { paused: !watch.paused },
      { onError: (error) => setNotice(error.message) },
    );

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">
            {watch.label}
          </h1>
          <p className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
            <a
              href={watch.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-ink"
            >
              {watch.host}
              <ExternalLink size={12} aria-hidden="true" />
              <span className="sr-only">(opens the shop’s page)</span>
            </a>
            <span>checked {every(watch.intervalSeconds)}</span>
            {lastGood !== null && (
              <span className="inline-flex items-center gap-1.5" style={{ color: patina(age) }}>
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: patina(age) }}
                  aria-hidden="true"
                />
                read {ago(now - lastGood)}
              </span>
            )}
            {problem && (
              <span className="rounded-full border border-line px-2 py-0.5">{problem}</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={checkNow}
            busy={actions.checkNow.isPending || eager}
            disabled={watch.paused}
          >
            {!eager && !actions.checkNow.isPending && <RefreshCw size={16} aria-hidden="true" />}
            {eager ? 'Checking…' : 'Check now'}
          </Button>
          <Button onClick={togglePause} busy={actions.update.isPending && dragTarget === null}>
            {watch.paused ? (
              <Play size={16} aria-hidden="true" />
            ) : (
              <Pause size={16} aria-hidden="true" />
            )}
            {watch.paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </header>

      {notice && <Notice tone="error">{notice}</Notice>}

      <section className="flex flex-wrap items-end justify-between gap-6">
        {watch.price !== null ? (
          <PriceDigits
            value={watch.price}
            currency={currency}
            className="text-[56px] leading-none font-medium"
          />
        ) : (
          <p className="text-[17px] text-ink-2">{waiting(watch)}</p>
        )}
        <div className="tabular text-right text-[13px] leading-6">
          {target === null ? (
            watch.price !== null && (
              <Button
                variant="primary"
                onClick={() =>
                  actions.update.mutate({
                    targetPrice: Math.max(step, Math.floor((watch.price! * 0.9) / step) * step),
                  })
                }
              >
                Set a target
              </Button>
            )
          ) : (
            <>
              <div>target {formatMoney(target, currency)}</div>
              {above !== null &&
                (above > 0 ? (
                  <div className="text-ink-2">{distanceWords(above, currency).text}</div>
                ) : (
                  <div className="font-semibold text-copper-deep">
                    {distanceWords(above, currency, 'your target').text}
                  </div>
                ))}
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="history">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-4">
            <h2 id="history" className="text-[15px] font-semibold">
              Price history
            </h2>
            <a
              href={`/api/watches/${id}/history.csv`}
              download
              className="text-[13px] text-copper-deep underline"
            >
              Download CSV
            </a>
          </div>
          <div
            className="flex rounded-[8px] border border-line p-0.5"
            role="group"
            aria-label="Range"
          >
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={range === r.key}
                onClick={() => setRange(r.key)}
                className={`tabular rounded-[6px] px-2.5 py-1 text-[12px] transition ${
                  range === r.key ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {points.length ? (
          <>
            <StepChart
              points={points}
              target={target}
              currency={currency}
              domain={domain}
              now={now}
              height={320}
              ticks={timeTicks(domain)}
              // Within two days the ticks are hours apart: label them with the time.
              tickLabel={domain[1] - domain[0] < 2 * 86_400_000 ? words.time : words.day}
              describeTime={words.moment}
              bands={soldOutBands(watch.history, now)}
              events={events.flatMap((event) => {
                const label = chartFlag(event.kind);
                const t = Date.parse(event.at);
                return label && t >= domain[0] ? [{ t, label }] : [];
              })}
              onTargetChange={target === null ? undefined : moveTarget}
              targetStep={step}
              label={`${watch.label}: price history, ${
                watch.price === null ? 'no price yet' : `now ${formatMoney(watch.price, currency)}`
              }${target === null ? '' : `, target ${formatMoney(target, currency)}`}`}
            />
            <p className="tabular mt-3 flex flex-wrap justify-between gap-2 text-[12px] text-ink-2">
              <span>
                {span &&
                  `Lowest ${formatMoney(span.low, currency)} · highest ${formatMoney(span.high, currency)} in this range`}
              </span>
              {target !== null && <span>Drag the copper line to move your target.</span>}
            </p>
          </>
        ) : (
          <div className="grid h-[200px] place-items-center rounded-[14px] border border-dashed border-line text-sm text-ink-2">
            The history starts with the first price we read.
          </div>
        )}
      </section>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Timeline events={events} now={now} moment={words.moment} />
        <CheckLog checks={checks.data ?? []} now={now} currency={currency} moment={words.moment} />
      </div>

      <Settings
        watch={watch}
        actions={actions}
        onRemoved={() => navigate('/app', { replace: true })}
      />
    </div>
  );
}

export function ProductPage() {
  const id = useParams().id!;
  const already = (useLocation().state as { already?: boolean } | null)?.already;
  const [eager, setEager] = useState(false);
  const detail = useWatch(id, eager);

  return (
    <>
      <Link
        to="/app"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Watchlist
      </Link>
      {already && (
        <div className="mb-6">
          <Notice>That product is already on your watchlist, so here it is.</Notice>
        </div>
      )}
      {detail.isPending ? (
        <div className="h-[480px] animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      ) : detail.isError ? (
        <div className="max-w-xl space-y-4">
          <Notice tone="error">
            {detail.error instanceof ApiError && detail.error.status === 404
              ? 'We couldn’t find that product. It may have been removed.'
              : detail.error.message}
          </Notice>
          <Link to="/app" className={buttonClass('quiet')}>
            Back to the watchlist
          </Link>
        </div>
      ) : (
        <Product id={id} detail={detail.data} eager={eager} onEager={setEager} />
      )}
    </>
  );
}
