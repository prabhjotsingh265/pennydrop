import type { SiteSummary } from '@pennydrop/domain';
import { useMe, useSites } from '../lib/queries.ts';
import { paceWords, recipeWords, robotsWords, siteHealth, type Health } from '../lib/sites.ts';
import { ago, dateWords, useNow } from '../lib/time.ts';
import { Notice } from '../ui/Notice.tsx';

const TONES: Record<Health['tone'], string> = {
  good: 'border-verdigris-deep/40 text-verdigris-deep',
  warn: 'border-copper-deep/50 text-copper-deep',
  bad: 'border-danger/50 text-danger',
};

function ms(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function SiteCard({
  site,
  now,
  time,
}: {
  site: SiteSummary;
  now: number;
  time: (t: number) => string;
}) {
  const health = siteHealth(site, now);
  const { checks, good, medianMs } = site.lastDay;
  const share = checks ? good / checks : null;
  const restingUntil = site.breaker.openUntil ? Date.parse(site.breaker.openUntil) : null;

  return (
    <article className="rounded-[14px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="tabular truncate text-[15px] font-medium">{site.host}</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {site.products} {site.products === 1 ? 'product' : 'products'} of yours
            {site.needsBrowser && ' · read in a browser'}
          </p>
        </div>
        <span
          className={`tabular rounded-full border px-2.5 py-0.5 text-[11px] ${TONES[health.tone]}`}
        >
          {health.label}
          {health.label === 'Resting' && restingUntil !== null && ` until ${time(restingUntil)}`}
        </span>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span>
            {share === null
              ? 'No checks in the last day'
              : `${Math.round(share * 100)}% read properly in the last day`}
          </span>
          {checks > 0 && (
            <span className="tabular text-[11px] text-ink-2">
              {good} of {checks}
              {medianMs !== null && ` · typically ${ms(medianMs)}`}
            </span>
          )}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden="true">
          {share !== null && (
            <div
              className={`h-full rounded-full ${share >= 0.8 ? 'bg-verdigris' : 'bg-copper'}`}
              style={{ width: `${share * 100}%` }}
            />
          )}
        </div>
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-ink-2">Our pace</dt>
        <dd>{paceWords(site)}</dd>
        <dt className="text-ink-2">Its rules</dt>
        <dd>
          {robotsWords(site)}
          {site.robots.fetchedAt && (
            <span className="text-ink-2"> · {ago(now - Date.parse(site.robots.fetchedAt))}</span>
          )}
        </dd>
        <dt className="text-ink-2">The price</dt>
        <dd>
          {site.recipe ? (
            <>
              <code className="tabular rounded bg-paper px-1.5 py-0.5 text-[12px]">
                {site.recipe.selector}
                {site.recipe.attribute && ` @${site.recipe.attribute}`}
              </code>{' '}
              <span className="text-ink-2">
                {recipeWords(site.recipe.source)}, {ago(now - Date.parse(site.recipe.since))}
              </span>
            </>
          ) : (
            <span className="text-ink-2">Read from the page’s structured data and layout</span>
          )}
        </dd>
      </dl>
    </article>
  );
}

/** Every shop the workspace watches something on, and how checking it is going. */
export function SitesPage() {
  const sites = useSites();
  const now = useNow();
  const me = useMe().data!;
  const { time } = dateWords(me.workspace.timezone);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">Sites</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          Each shop is checked at its own polite pace. One that keeps failing is left to rest, so it
          never holds up the others.
        </p>
      </div>
      {sites.isPending ? (
        <div className="h-48 animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      ) : sites.isError ? (
        <Notice tone="error">{sites.error.message}</Notice>
      ) : sites.data.length === 0 ? (
        <p className="text-sm text-ink-2">Shops appear here once you watch something on them.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sites.data.map((site) => (
            <SiteCard key={site.id} site={site} now={now} time={time} />
          ))}
        </div>
      )}
    </>
  );
}
