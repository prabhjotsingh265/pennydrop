import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { useTitle } from '../lib/title.ts';
import { Button, buttonClass } from '../ui/Button.tsx';

/**
 * Whatever a page throws ends here, rather than in a blank screen. Kept
 * plain on purpose: it mustn't depend on the things that may have failed.
 */
export function ErrorPage() {
  useTitle('Something went wrong · Pennydrop');
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[72ch] flex-col justify-center bg-paper px-4 py-20 text-ink sm:px-6">
      <p className="tabular text-[12px] text-danger">Error</p>
      <h1 className="mt-3 text-[clamp(32px,4.4vw,52px)] leading-[0.95] font-semibold tracking-[-0.025em] [font-stretch:108%]">
        This page broke.
      </h1>
      <p className="mt-5 max-w-[52ch] text-[16px] leading-relaxed text-ink-2">
        Something went wrong while showing it. Your products and their prices are safe: they’re kept
        on the server, and checking carries on. Reloading usually puts it right.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
        <Link to="/app" className={buttonClass('quiet')} reloadDocument>
          Your watchlist
        </Link>
      </div>
      <details className="mt-10 text-[13px] text-ink-2">
        <summary className="cursor-pointer">Details, for a bug report</summary>
        <pre className="tabular mt-2 overflow-x-auto rounded-[8px] bg-surface p-3 whitespace-pre-wrap">
          {detail}
        </pre>
      </details>
    </main>
  );
}
