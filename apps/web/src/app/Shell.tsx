import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Moon, Plus, Sun } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { authClient } from '../lib/auth-client.ts';
import { useMe } from '../lib/queries.ts';
import { useTheme } from '../lib/theme.ts';
import { buttonClass } from '../ui/Button.tsx';

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
          <div className="truncate text-[13px] text-ink-2">{me.user.email}</div>
          <div className="tabular mt-1 text-[11px] text-ink-2">{me.workspace.name}</div>
        </div>
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

export function Shell() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
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
          <nav className="flex items-center gap-1 text-sm" aria-label="Main">
            <NavLink to="/app" end className={navClass}>
              Watchlist
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link to="/app/add" className={buttonClass('primary', 'px-3 sm:px-4')}>
              <Plus size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Add product</span>
              <span className="sr-only sm:hidden">Add product</span>
            </Link>
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
