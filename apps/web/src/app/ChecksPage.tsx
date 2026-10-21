import { useSearchParams } from 'react-router';
import { useCheckFeed, useMe } from '../lib/queries.ts';
import { dateWords, useNow } from '../lib/time.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { CheckRow, TimingLegend, timingScale } from './product/CheckLog.tsx';

const VIEWS = [
  { key: 'all', label: 'All' },
  { key: 'problems', label: 'Problems' },
] as const;

/** Every check across the workspace, newest first. */
export function ChecksPage() {
  const [params, setParams] = useSearchParams();
  const show = params.get('show') === 'problems' ? 'problems' : 'all';
  const feed = useCheckFeed(show);
  const now = useNow();
  const me = useMe().data!;
  const { moment } = dateWords(me.workspace.timezone);
  const checks = feed.data?.pages.flatMap((page) => page.checks) ?? [];
  const scale = timingScale(checks);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">Checks</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Every visit to every page, with how long each step took.
          </p>
        </div>
        <div className="flex rounded-[8px] border border-line p-0.5" role="group" aria-label="Show">
          {VIEWS.map((view) => (
            <button
              key={view.key}
              type="button"
              aria-pressed={show === view.key}
              onClick={() => setParams(view.key === 'all' ? {} : { show: view.key })}
              className={`rounded-[6px] px-3 py-1 text-[13px] transition ${
                show === view.key ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      {feed.isPending ? (
        <div className="h-64 animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      ) : feed.isError ? (
        <Notice tone="error">{feed.error.message}</Notice>
      ) : checks.length === 0 ? (
        <p className="text-sm text-ink-2">
          {show === 'problems'
            ? 'No problems. Every recent check read its page.'
            : 'No checks yet.'}
        </p>
      ) : (
        <div className="max-w-3xl">
          <TimingLegend />
          <ul className="mt-3 divide-y divide-line">
            {checks.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                now={now}
                currency="GBP"
                moment={moment}
                scale={scale}
                product={{ label: check.label, href: `/app/p/${check.watchId}` }}
              />
            ))}
          </ul>
          {feed.hasNextPage && (
            <Button
              className="mt-4"
              busy={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
            >
              Show older checks
            </Button>
          )}
        </div>
      )}
    </>
  );
}
