import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError, api } from '../lib/api.ts';
import { authClient } from '../lib/auth-client.ts';
import { fetchMe, keys } from '../lib/queries.ts';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { AuthLayout } from './AuthLayout.tsx';

// One start per visit, however often React runs the effect (twice, in development).
let starting: Promise<unknown> | null = null;
const startDemo = () =>
  (starting ??= api('/api/demo', { method: 'POST' }).finally(() => {
    starting = null;
  }));

/** "Try the demo": one click, and a day in Pennydrop with a shop of your own to break. */
export function DemoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    startDemo()
      // Learn who's signed in before going on, or the dashboard's guard sends them back.
      .then(() => queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 0 }))
      .then(() => current && navigate('/app', { replace: true }))
      .catch((error: unknown) => {
        if (current) setProblem(error instanceof ApiError ? error : new ApiError(0, String(error)));
      });
    return () => {
      current = false;
    };
  }, [attempt, navigate, queryClient]);

  const signOutAndStart = async () => {
    await authClient.signOut();
    queryClient.clear();
    setProblem(null);
    setAttempt((n) => n + 1);
  };

  return (
    <AuthLayout title={problem ? 'The demo didn’t open' : 'Opening your demo…'}>
      {problem ? (
        <div className="space-y-5">
          <Notice tone="error">{problem.message}</Notice>
          {problem.status === 409 ? (
            <Button variant="primary" onClick={() => void signOutAndStart()}>
              Sign out and try the demo
            </Button>
          ) : (
            problem.status !== 503 && (
              <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
            )
          )}
        </div>
      ) : (
        <div className="space-y-4" aria-busy="true">
          <p className="text-[15px] leading-7">
            A day in Pennydrop, no account needed: products with weeks of history, and a shop of
            your own to break.
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-surface">
            <div className="h-full w-1/3 animate-[demo-load_1.2s_ease-in-out_infinite] rounded-full bg-copper motion-reduce:animate-none" />
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
