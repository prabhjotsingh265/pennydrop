import { Link } from 'react-router';
import { endsWords } from '../lib/demo.ts';
import { useDemo, useMe } from '../lib/queries.ts';
import { useNow } from '../lib/time.ts';

/** In a demo: how long is left, where to break your own shop, and how to keep going for real. */
export function DemoBanner() {
  const me = useMe().data;
  const sandbox = useDemo().data?.sandbox;
  const now = useNow();
  if (!me?.workspace.isDemo) return null;
  return (
    <div className="border-b border-copper/30 bg-copper/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm sm:px-6">
        <p className="mr-auto">
          <strong>Demo</strong>
          {me.workspace.expiresAt && <>, {endsWords(me.workspace.expiresAt, now)}</>}.{' '}
          {sandbox && (
            <>
              Break{' '}
              <Link to={`/app/p/${sandbox.watchId}`} className="font-medium underline">
                your own shop
              </Link>{' '}
              and watch Pennydrop recover.
            </>
          )}
        </p>
        <Link to="/signup" className="font-medium text-copper-deep underline">
          Create an account
        </Link>
      </div>
    </div>
  );
}
