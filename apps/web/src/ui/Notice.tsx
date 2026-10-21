import type { ReactNode } from 'react';

/** A message about the whole form or page, rather than one field. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-[8px] border px-3.5 py-3 text-sm ${
        tone === 'error' ? 'border-danger/40 text-danger' : 'border-line bg-surface text-ink'
      }`}
    >
      {children}
    </div>
  );
}
