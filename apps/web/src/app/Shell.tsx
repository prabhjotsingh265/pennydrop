import { useQueryClient } from '@tanstack/react-query';
import { BellRing, LogOut, Moon, Plus, Settings, Sun } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { authClient } from '../lib/auth-client.ts';
import { useLiveStatus } from '../lib/live-status.ts';
import { useLiveUpdates } from '../lib/live.ts';
import { useMe } from '../lib/queries.ts';
import { useTheme } from '../lib/theme.ts';
import { buttonClass } from '../ui/Button.tsx';
import { DemoBanner } from './DemoBanner.tsx';
import { InboxBell } from './InboxBell.tsx';
import { ZoneNudge } from './ZoneNudge.tsx';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-[8px] px-3 py-2 transition ${isActive ? 'bg-surface font-medium text-ink' : 'text-ink-2 hover:text-ink'}`;

function AccountMenu() {
  const me = useMe().data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!me) return null;

  const signOut = async () => {
    await authClient.signOut();
    navigate('/signin', { replace: true });
    queryClient.clear();
  };

  return (
    <details className="relative">
      <summary
        className="grid size-10 cursor-pointer list-none place-items-center rounded-full border border-line bg-surface text-sm font-semibold uppercase [&::-webkit-details-marker]:hidden"
        aria-label={`Account: ${me.user.name}`}
      >
        {me.user.name.trim().charAt(0) || '?'}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-64 rounded-[14px] border border-line bg-paper p-2 shadow-lg shadow-ink/5">
        <div className="px-3 py-2">
          <div className="truncate text-sm font-medium">{me.user.name}</div>
          {/* A demo visitor's "email" is a placeholder: not worth showing. */}
          {!me.workspace.isDemo && (
            <div className="truncate text-[13px] text-ink-2">{me.user.email}</div>
          )}
          <div className="tabular mt-1 text-[11px] text-ink-2">{me.workspace.name}</div>
        </div>
        <Link
          to="/app/settings"
          className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm hover:bg-surface"
        >
          <Settings size={16} aria-hidden="true" /> Settings
        </Link>
        <Link
          to="/app/channels"
          className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm hover:bg-surface"
        >
          <BellRing size={16} aria-hidden="true" /> Alert channels
        </Link>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left text-sm hover:bg-surface"
        >
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
      </div>
    </details>
  );
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-10 place-items-center rounded-full text-ink-2 hover:text-ink"
      aria-label={theme === 'dark' ? 'Use the light theme' : 'Use the dark theme'}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/** A small sign that updates arrive by themselves; colour is never the only signal. */
function LiveMark() {
  const live = useLiveStatus();
  return (
    <span
      className="tabular hidden items-center gap-1.5 text-[11px] text-ink-2 md:inline-flex"
      title={
        live
          ? 'Prices update here as soon as they’re checked.'
          : 'Reconnecting: prices refresh every 30 s meanwhile.'
      }
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${live ? 'bg-verdigris' : 'border border-ink-2'}`}
      />
      {live ? 'Live' : 'Offline'}
    </span>
  );
}

export function Shell() {
  useLiveUpdates();
  const isDemo = useMe().data?.workspace.isDemo ?? false;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        {/* On a phone the links get a row of their own, under the logo and actions. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 px-4 pt-2 sm:h-16 sm:flex-nowrap sm:gap-6 sm:px-6 sm:pt-0">
          <Link
            to="/app"
            className="flex items-center gap-2"
            aria-label="Pennydrop, your watchlist"
          >
            <BrandMark size={28} />
            <span className="hidden text-lg font-semibold [font-stretch:112%] sm:inline">
              Pennydrop
            </span>
          </Link>
          <nav
            className="order-last -mx-3 flex w-full items-center gap-1 overflow-x-auto py-1 text-sm sm:order-none sm:mx-0 sm:w-auto sm:py-0"
            aria-label="Main"
          >
            <NavLink to="/app" end className={navClass}>
              Watchlist
            </NavLink>
            <NavLink to="/app/groups" className={navClass}>
              Compare
            </NavLink>
            <NavLink to="/app/sites" className={navClass}>
              Sites
            </NavLink>
            <NavLink to="/app/checks" className={navClass}>
              Checks
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LiveMark />
            <Link to="/app/add" className={buttonClass('primary', 'px-3 sm:px-4')}>
              <Plus size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Add product</span>
              <span className="sr-only sm:hidden">Add product</span>
            </Link>
            <InboxBell />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>
      {/* A demo lasts a day: its time zone isn't worth asking about. */}
      {isDemo ? <DemoBanner /> : <ZoneNudge />}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
