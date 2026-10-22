import type { LanesView } from '@pennydrop/domain';
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../../lib/api.ts';
import { stageOf, type Stage } from '../../lib/system.ts';

const POLL_MS = 1_500;
/** A dot stays on screen this long: long enough to see a parked one. */
const KEEP_MS = 9_000;
/** Where a check that didn't read the page stops: at the stage it got to. */
const STOP: Record<Stage, string> = { fetch: '14%', extract: '48%', save: '100%' };

interface Dot {
  id: string;
  host: string;
  read: boolean;
  outcome: string;
  /** When it arrived in this page, for clearing it away. */
  born: number;
  /** When, within the last look's window, it happened. */
  delay: number;
}

function Breaker({
  site,
  time,
}: {
  site: LanesView['sites'][number];
  time: (t: number) => string;
}) {
  if (site.breaker === 'open') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-danger">
        <ShieldAlert size={13} aria-hidden="true" />
        Breaker open
        {site.openUntil && <> until {time(Date.parse(site.openUntil))}</>}
      </span>
    );
  }
  if (site.breaker === 'half_open') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-copper-deep">
        <ShieldQuestion size={13} aria-hidden="true" />
        Trying again
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-2">
      <ShieldCheck size={13} aria-hidden="true" />
      Healthy
    </span>
  );
}

/**
 * Signature moment 4: one lane per site, each check a dot running fetch →
 * extract → save. When a site fails, its dots stop where they got to and park
 * below the lane, its breaker opens and the lane is hatched, while the other
 * lanes keep flowing.
 */
export function Lanes({ time }: { time: (t: number) => string }) {
  const [sites, setSites] = useState<LanesView['sites']>([]);
  const [dots, setDots] = useState<Dot[]>([]);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let since: number | undefined;
    let stopped = false;
    let timer = 0;
    const look = async () => {
      try {
        const view = await api<LanesView>(
          `/api/admin/lanes${since === undefined ? '' : `?since=${since}`}`,
        );
        if (stopped) return;
        const born = performance.now();
        // Checks are committed a moment after they finish: ask a little way back, and drop repeats.
        const latest = view.checks.at(-1)?.at;
        since = Math.max(latest ?? since ?? view.at, view.at - 60_000) - 2_000;
        setSites(view.sites);
        setDots((old) => {
          const seen = new Set(old.map((dot) => dot.id));
          const fresh = view.checks
            .filter((check) => !seen.has(check.id))
            .map((check) => ({
              id: check.id,
              host: check.host,
              read: check.read,
              outcome: check.outcome,
              born,
              // Spread over the last look's window, as the checks really came.
              delay: Math.max(0, Math.min(POLL_MS, POLL_MS - (view.at - check.at))),
            }));
          return [...old.filter((dot) => born - dot.born < KEEP_MS), ...fresh];
        });
        setLost(false);
      } catch {
        if (!stopped) setLost(true);
      } finally {
        if (!stopped) timer = window.setTimeout(() => void look(), POLL_MS);
      }
    };
    void look();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Every site with a breaker worth showing, and any other a check just came from.
  const hosts = [...new Set([...sites.map((site) => site.host), ...dots.map((dot) => dot.host)])];
  const siteOf = (host: string) =>
    sites.find((site) => site.host === host) ?? { host, breaker: 'closed', openUntil: null };

  return (
    <section aria-labelledby="lanes" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="lanes" className="text-[15px] font-semibold">
          Lanes
        </h2>
        <p className="text-[12px] text-ink-2">
          {lost
            ? 'Lost touch with the API: trying again.'
            : 'Each dot is a check, live. One that didn’t read the page stops where it got to.'}
        </p>
      </div>
      {hosts.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-line p-6 text-sm text-ink-2">
          Quiet: no checks in the last few minutes.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
            <span />
            <div className="tabular grid grid-cols-3 text-[11px] text-ink-2" aria-hidden="true">
              <span>fetch</span>
              <span className="text-center">extract</span>
              <span className="text-right">save</span>
            </div>
          </div>
          {hosts.map((host) => {
            const site = siteOf(host);
            const mine = dots.filter((dot) => dot.host === host);
            const read = mine.filter((dot) => dot.read).length;
            return (
              <div
                key={host}
                className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
              >
                <div className="min-w-0">
                  <div className="tabular truncate text-[12px]">{host}</div>
                  <Breaker site={site} time={time} />
                  <div className="tabular text-[11px] text-ink-2">
                    {read} read · {mine.length - read} not
                  </div>
                </div>
                <div
                  className={`relative h-14 overflow-hidden rounded-[8px] border border-line ${
                    site.breaker === 'open' ? 'hatch' : 'bg-surface'
                  }`}
                  aria-hidden="true"
                >
                  <div className="absolute inset-x-2 top-[calc(50%-0.5px)] h-px bg-line" />
                  <div className="absolute inset-y-2 left-1/3 w-px bg-line" />
                  <div className="absolute inset-y-2 left-2/3 w-px bg-line" />
                  {mine.map((dot) => (
                    <span
                      key={dot.id}
                      className={`absolute inset-y-0 left-2 w-[calc(100%-1.75rem)] ${
                        dot.read ? 'lane-run' : 'lane-stop'
                      }`}
                      style={
                        {
                          '--delay': `${dot.delay}ms`,
                          '--stop': STOP[stageOf(dot)],
                        } as CSSProperties
                      }
                    >
                      <span
                        className={`lane-dot absolute top-[calc(50%-6px)] left-0 size-3 rounded-full ${
                          dot.read
                            ? 'bg-ink'
                            : dot.outcome === 'skipped_breaker_open'
                              ? 'border-2 border-ink-2 bg-paper'
                              : 'bg-danger'
                        }`}
                      />
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
