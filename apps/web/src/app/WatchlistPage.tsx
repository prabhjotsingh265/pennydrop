import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { useWatches } from '../lib/queries.ts';
import { useNow } from '../lib/time.ts';
import { byCloseness, reached } from '../lib/watchlist.ts';
import { buttonClass } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { FlipGrid } from './FlipGrid.tsx';
import { WatchCard } from './WatchCard.tsx';

function Empty() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <BrandMark size={72} />
      <h1 className="mt-6 text-[22px] font-semibold [font-stretch:108%]">
        Nothing on your watchlist yet
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
        Paste a product’s address. Pennydrop finds its price, checks it as often as you like, and
        tells you when it drops through your target.
      </p>
      <Link to="/app/add" className={buttonClass('primary', 'mt-6')}>
        <Plus size={16} aria-hidden="true" /> Add your first product
      </Link>
    </div>
  );
}

export function WatchlistPage() {
  const watches = useWatches();
  const now = useNow();

  if (watches.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[170px] animate-pulse rounded-[14px] bg-surface" />
        ))}
      </div>
    );
  }
  if (watches.isError) return <Notice tone="error">{watches.error.message}</Notice>;
  if (!watches.data.length) return <Empty />;

  const sorted = [...watches.data].sort(byCloseness);
  const under = sorted.filter(reached).length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">Watchlist</h1>
        <p className="tabular mt-1 text-[12px] text-ink-2">
          {sorted.length} {sorted.length === 1 ? 'product' : 'products'} · {under} at or under
          target · closest to target first
        </p>
      </div>
      <FlipGrid order={sorted.map((watch) => watch.id).join()}>
        {sorted.map((watch) => (
          <WatchCard key={watch.id} watch={watch} now={now} />
        ))}
      </FlipGrid>
    </>
  );
}
