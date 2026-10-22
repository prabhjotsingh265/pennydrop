import { Link } from 'react-router';
import { Part, PublicPage } from './PublicChrome.tsx';

const list = 'list-disc space-y-1.5 pl-5';

/** The plain rules for using Pennydrop. */
export function TermsPage() {
  return (
    <PublicPage title="Terms" updated="22 October 2026">
      <p className="text-[17px]">
        Pennydrop watches shop prices and tells you when they change. These are the rules for using
        it, in plain words.
      </p>

      <Part title="What you can watch">
        <ul className={list}>
          <li>Public product pages: nothing behind a sign-in.</li>
          <li>
            Not sites whose terms forbid automated access, or whose robots.txt turns us away; we
            refuse those we know of. See{' '}
            <Link to="/bot" className="underline">
              our crawler
            </Link>{' '}
            for how it behaves.
          </li>
          <li>
            Up to 100 products in a workspace. Each is checked as often as you choose, or as the
            shop allows if that’s less often.
          </li>
        </ul>
      </Part>

      <Part title="Prices and alerts">
        <p>
          Pennydrop reads prices carefully, but shops change, pages break and readings can be wrong.
          Check the price at the shop before you buy. Alerts are sent as soon as they can be, but
          they can be late, or held for your quiet hours or daily summary.
        </p>
      </Part>

      <Part title="Your data">
        <p>
          What you put in is yours. We use it only to run Pennydrop for you, and you can download it
          or delete it at any time (see{' '}
          <Link to="/privacy" className="underline">
            privacy
          </Link>
          ).
        </p>
      </Part>

      <Part title="The demo">
        <p>
          The demo watches the practice shops only, sends at most five emails a day, and is deleted
          after a day.
        </p>
      </Part>

      <Part title="Fair use">
        <p>
          Don’t use Pennydrop to overload a shop, to reach places it shouldn’t, or to send alerts to
          people who didn’t ask for them. Limits on how often you can sign in, check now and the
          like keep it fair; an account that abuses it may be closed.
        </p>
      </Part>

      <Part title="No promises">
        <p>
          Pennydrop is a portfolio project, provided as it is, without warranties, and it may change
          or stop. It isn’t liable for decisions made on its readings.
        </p>
      </Part>

      <Part title="Questions">
        <p>
          Ask in an issue on{' '}
          <a href="https://github.com/prabhjotsingh265/pennydrop/issues" className="underline">
            GitHub
          </a>
          .
        </p>
      </Part>
    </PublicPage>
  );
}
