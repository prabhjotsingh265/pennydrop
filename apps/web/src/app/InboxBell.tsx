import { Bell } from 'lucide-react';
import { NavLink } from 'react-router';
import { useArrivals } from '../lib/live-status.ts';
import { useUnread } from '../lib/queries.ts';

/** The inbox's bell. Each alert that arrives while you're here drops a penny into it. */
export function InboxBell() {
  const unread = useUnread().data ?? 0;
  const drops = useArrivals();
  const count = unread > 99 ? '99+' : String(unread);
  const words = unread ? `${unread} new ${unread === 1 ? 'alert' : 'alerts'}` : '';

  return (
    <>
      <NavLink
        to="/app/alerts"
        className={({ isActive }) =>
          `relative grid size-10 place-items-center rounded-full transition ${
            isActive ? 'bg-surface text-ink' : 'text-ink-2 hover:text-ink'
          }`
        }
        aria-label={unread ? `Alerts, ${words}` : 'Alerts'}
      >
        {({ isActive }) => (
          <>
            {drops > 0 && (
              <span
                key={drops}
                aria-hidden="true"
                className="penny absolute top-1 left-1/2 size-2.5 rounded-full bg-copper shadow-[inset_0_-1px_0_var(--copper-deep)]"
              />
            )}
            {/* In front of the penny and filled, so the penny goes into it. Mounted afresh for each penny, so the ring plays again. */}
            <span
              key={`ring-${drops}`}
              className={`relative ${drops > 0 ? 'bell-ring' : 'inline-block'}`}
            >
              <Bell
                size={18}
                aria-hidden="true"
                className={isActive ? 'fill-surface' : 'fill-paper'}
              />
            </span>
            {unread > 0 && (
              <span className="tabular absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-copper px-1 text-center text-[10px] leading-[18px] font-medium text-on-copper">
                {count}
              </span>
            )}
          </>
        )}
      </NavLink>
      {/* Said aloud when it changes. */}
      <span role="status" className="sr-only">
        {words}
      </span>
    </>
  );
}
