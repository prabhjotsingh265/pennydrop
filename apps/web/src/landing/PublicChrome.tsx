import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { useMe } from '../lib/queries.ts';
import { useTheme } from '../lib/theme.ts';
import { useTitle } from '../lib/title.ts';
import { buttonClass } from '../ui/Button.tsx';

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="tabular rounded-full border border-line bg-surface px-3 py-1.5 text-[11px]"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}

/** The public pages' header: overlaid on the landing page's hero, in the flow elsewhere. */
export function Header({ overlay = false }: { overlay?: boolean }) {
  const me = useMe().data;
  return (
    <header
      className={`${overlay ? 'absolute inset-x-0 top-0 z-10' : 'border-b border-line'} flex items-center justify-between gap-4 px-[max(16px,4vw)] py-5`}
    >
      <Link to="/" className="flex items-center gap-2.5" aria-label="Pennydrop, home">
        <BrandMark size={28} />
        <span className="text-[17px] font-semibold tracking-[-0.01em] [font-stretch:110%]">
          Pennydrop
        </span>
      </Link>
      <nav className="flex items-center gap-2 sm:gap-3" aria-label="Account">
        <ThemeToggle />
        {me ? (
          <Link to="/app" className={buttonClass('primary')}>
            {me.workspace.isDemo ? 'Back to your demo' : 'Your watchlist'}
          </Link>
        ) : (
          <>
            <Link to="/signin" className="px-2 text-sm font-medium hover:underline">
              Sign in
            </Link>
            {/* On a phone the hero's own button is enough; the header keeps to one line. */}
            <span className="hidden sm:block">
              <Link to="/demo" className={buttonClass('primary')}>
                Try the demo
              </Link>
            </span>
          </>
        )}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line px-[max(16px,4vw)] py-10 text-[13px] text-ink-2">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex items-center gap-2.5">
          <BrandMark size={22} />
          <span>Pennydrop: price monitoring that keeps going.</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="About">
          <Link to="/bot" className="hover:text-ink hover:underline">
            Our crawler
          </Link>
          <Link to="/privacy" className="hover:text-ink hover:underline">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-ink hover:underline">
            Terms
          </Link>
          <a
            href="https://github.com/prabhjotsingh265/pennydrop"
            className="hover:text-ink hover:underline"
          >
            Source on GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

/** A plain public page: the crawler's information, privacy, terms. */
export function PublicPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  useTitle(`${title} · Pennydrop`);
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <Header />
      <main className="mx-auto w-full max-w-[72ch] flex-1 px-4 py-14 sm:px-6">
        <h1 className="text-[clamp(32px,4.4vw,52px)] leading-[0.95] font-semibold tracking-[-0.025em] [font-stretch:108%]">
          {title}
        </h1>
        <p className="tabular mt-4 text-[12px] text-ink-2">Last updated {updated}</p>
        <div className="mt-10 space-y-10 text-[15px] leading-relaxed">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

/** One part of a public page, under its heading. */
export function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[19px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}
