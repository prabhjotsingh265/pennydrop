import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CompareChart } from '../components/CompareChart.tsx';
import { api } from '../lib/api.ts';
import { timeTicks } from '../lib/chart.ts';
import {
  cheapest,
  compareDomain,
  defaultCompareDays,
  seriesFor,
  undercut,
} from '../lib/compare.ts';
import { formatMoney } from '../lib/money.ts';
import { keys, useGroup, useMe } from '../lib/queries.ts';
import { useTheme } from '../lib/theme.ts';
import { ago, dateWords, useNow } from '../lib/time.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';

/** Compare holds up to 90 days; "All" fits whatever readings there are within them. */
const COMPARE_RANGES = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: 'All', days: null },
] as const;

/** One item at several shops: a line each, the cheapest marked, and who undercuts you. */
export function ComparePage() {
  const id = useParams().id!;
  const group = useGroup(id);
  const now = useNow();
  const [theme] = useTheme();
  const me = useMe().data!;
  const words = dateWords(me.workspace.timezone);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Until someone picks a range: all of a young group's history, else the last 30 days.
  const [range, setRange] = useState<number | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

  if (group.isPending)
    return <div className="h-96 animate-pulse rounded-[14px] bg-surface" aria-busy="true" />;
  if (group.isError) {
    return (
      <div className="max-w-xl space-y-4">
        <Notice tone="error">{group.error.message}</Notice>
        <Link to="/app/groups" className="text-sm text-copper-deep underline">
          All groups
        </Link>
      </div>
    );
  }

  const { watches } = group.data;
  const series = seriesFor(watches, theme);
  const best = cheapest(watches);
  const under = undercut(watches);
  const currency = best?.currency ?? watches[0]?.currency ?? 'GBP';
  const days = range === undefined ? defaultCompareDays(series, now) : range;
  const domain = compareDomain(series, days, now);
  // Within two days the ticks are hours apart: label them with the time.
  const tickLabel = domain[1] - domain[0] < 2 * 86_400_000 ? words.time : words.day;
  const ordered = [...series].sort(
    (a, b) =>
      (a.watch.price ?? Number.POSITIVE_INFINITY) - (b.watch.price ?? Number.POSITIVE_INFINITY),
  );

  const remove = async () => {
    await api(`/api/groups/${id}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: keys.groups });
    navigate('/app/groups', { replace: true });
  };

  return (
    <div className="space-y-10">
      <div>
        <Link
          to="/app/groups"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Compare
        </Link>
        <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">
          {group.data.group.name}
        </h1>
        <p className="tabular mt-1 text-[12px] text-ink-2">
          {watches.length} {watches.length === 1 ? 'shop' : 'shops'}
          {best && ` · cheapest now ${formatMoney(best.price, best.currency)}`}
        </p>
      </div>

      {under && (
        <div className="rounded-[14px] border border-copper/50 bg-copper/10 p-4 text-sm">
          <strong>{under.rival.host}</strong> is {formatMoney(under.by, under.currency)} cheaper
          than your listing.
        </div>
      )}
      {best?.mixed && (
        <Notice>
          Some shops price this in another currency, so they aren’t compared here yet.
        </Notice>
      )}

      {watches.length === 0 ? (
        <p className="text-sm text-ink-2">
          Nothing in this group yet. Open a product and choose this group under “Compare across
          shops”.
        </p>
      ) : (
        <>
          <section aria-labelledby="compare-history">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id="compare-history" className="text-[15px] font-semibold">
                Prices by shop
              </h2>
              <div
                className="flex rounded-[8px] border border-line p-0.5"
                role="group"
                aria-label="Range"
              >
                {COMPARE_RANGES.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    aria-pressed={days === r.days}
                    onClick={() => setRange(r.days)}
                    className={`tabular rounded-[6px] px-2.5 py-1 text-[12px] transition ${
                      days === r.days ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <CompareChart
              series={series}
              domain={domain}
              now={now}
              height={340}
              currency={currency}
              cheapestId={best?.watchId ?? null}
              ticks={timeTicks(domain)}
              tickLabel={tickLabel}
              describeTime={words.moment}
              label={`${group.data.group.name}: prices at ${watches.length} shops${
                days === null ? '' : ` over the last ${days} days`
              }`}
            />
          </section>

          <section aria-labelledby="compare-table">
            <h2 id="compare-table" className="mb-3 text-[15px] font-semibold">
              Now, cheapest first
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-ink-2">
                    <th className="py-2 pr-4 font-normal">Shop</th>
                    <th className="py-2 pr-4 text-right font-normal">Price</th>
                    <th className="py-2 pr-4 text-right font-normal">vs cheapest</th>
                    <th className="hidden py-2 text-right font-normal sm:table-cell">Read</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((s) => {
                    const w = s.watch;
                    const diff =
                      best && w.price !== null && w.currency === best.currency
                        ? w.price - best.price
                        : null;
                    return (
                      <tr key={w.id} className="border-b border-line">
                        <td className="py-2.5 pr-4">
                          <Link
                            to={`/app/p/${w.id}`}
                            className="inline-flex min-h-6 items-center gap-2 hover:text-copper-deep"
                          >
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ background: s.colour }}
                              aria-hidden="true"
                            />
                            {w.host}
                            {w.isMine && (
                              <span className="rounded-full border border-line px-1.5 text-[11px] text-ink-2">
                                You
                              </span>
                            )}
                          </Link>
                        </td>
                        <td className="tabular py-2.5 pr-4 text-right">
                          {w.price === null ? '—' : formatMoney(w.price, w.currency ?? currency)}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-right">
                          {diff === null ? (
                            '—'
                          ) : diff === 0 ? (
                            <span className="font-semibold text-copper-deep">cheapest</span>
                          ) : (
                            `+${formatMoney(diff, currency)}`
                          )}
                        </td>
                        <td className="tabular hidden py-2.5 text-right text-ink-2 sm:table-cell">
                          {w.lastSuccessAt ? ago(now - Date.parse(w.lastSuccessAt)) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <div className="max-w-xl rounded-[14px] border border-line p-4">
        {confirming ? (
          <div className="space-y-3">
            <p className="text-sm">Delete this group? Its products stay on your watchlist.</p>
            <div className="flex gap-3">
              <Button variant="danger" onClick={() => void remove()}>
                Delete group
              </Button>
              <Button onClick={() => setConfirming(false)}>Keep it</Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete this group
          </Button>
        )}
      </div>
    </div>
  );
}
