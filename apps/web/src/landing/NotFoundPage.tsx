import { Link } from 'react-router';
import { useTitle } from '../lib/title.ts';
import { buttonClass } from '../ui/Button.tsx';
import { Footer, Header } from './PublicChrome.tsx';

/** An address that leads nowhere: say so, and offer the ways on. */
export function NotFoundPage() {
  useTitle('Page not found · Pennydrop');
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <Header />
      <main className="mx-auto flex w-full max-w-[72ch] flex-1 flex-col justify-center px-4 py-20 sm:px-6">
        <p className="tabular text-[12px] text-copper-deep">404</p>
        <h1 className="mt-3 text-[clamp(32px,4.4vw,52px)] leading-[0.95] font-semibold tracking-[-0.025em] [font-stretch:108%]">
          Nothing at this address.
        </h1>
        <p className="mt-5 max-w-[52ch] text-[16px] leading-relaxed text-ink-2">
          Perhaps it moved, or the link lost a letter on the way. The price you were after is
          probably one of these.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/app" className={buttonClass('primary')}>
            Your watchlist
          </Link>
          <Link to="/" className={buttonClass('quiet')}>
            The front page
          </Link>
          <Link to="/demo" className={buttonClass('quiet')}>
            Try the demo
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
