import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from '../lib/queries.ts';
import { Button } from '../ui/Button.tsx';

/** The dashboard is for signed-in people: anyone else is sent to sign in, and brought back after. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <div className="min-h-dvh" aria-busy="true" />;
  if (me.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="text-[15px]">{me.error.message}</p>
          <Button className="mt-4" onClick={() => void me.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!me.data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }
  return children;
}
