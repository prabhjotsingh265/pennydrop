import { Part, PublicPage } from './PublicChrome.tsx';

const list = 'list-disc space-y-1.5 pl-5';

/** What Pennydrop keeps, why, for how long, and how to take it or have it deleted. */
export function PrivacyPage() {
  return (
    <PublicPage title="Privacy" updated="22 October 2026">
      <p className="text-[17px]">
        Pennydrop keeps what it needs to watch prices for you, and nothing to sell or to follow you
        around with.
      </p>

      <Part title="Your account">
        <ul className={list}>
          <li>Your name and email address, to sign you in and to send you what you ask for.</li>
          <li>Your password, only as a salted scrypt hash: nobody can read it back.</li>
          <li>
            Each signed-in session, with the IP address and browser it began from, so it can be
            recognised. A session lasts 30 days, and a new password ends every other one.
          </li>
        </ul>
      </Part>

      <Part title="What you watch">
        <ul className={list}>
          <li>
            The products you add, your targets and alert rules, your groups, and the alerts sent to
            you.
          </li>
          <li>
            Where your alerts go. Slack, Discord and webhook addresses are stored encrypted
            (AES-256-GCM) and only ever shown masked.
          </li>
          <li>
            From the shops’ pages: prices, “was” prices, currencies, stock and titles. Never
            anything personal. Price history is kept; the log of each check for 30 days (90 for
            failed ones); screenshots of failed checks for 7.
          </li>
        </ul>
      </Part>

      <Part title="Cookies and your browser">
        <p>
          One cookie, which keeps you signed in. It can’t be read by scripts, and it’s sent only to
          Pennydrop. No analytics, no advertising, nothing that tracks you from site to site. Your
          browser also remembers your light or dark theme, and whether you said no to switching time
          zone; that stays on your device.
        </p>
      </Part>

      <Part title="Emails">
        <p>
          We send confirmations, password resets, your alerts and the odd notice that an alert
          channel stopped working. Locally they’re caught by a test mailbox; the hosted version
          sends them through Resend.
        </p>
      </Part>

      <Part title="Keeping it running">
        <p>
          The server logs requests, with their IP addresses, to run and protect the service. To stop
          password guessing and floods, tries at signing in, signing up and similar are counted per
          IP address or per person, for at most an hour.
        </p>
      </Part>

      <Part title="The demo">
        <p>
          The demo signs you in with no email or password. Everything in it, including your own copy
          of the practice shop, is deleted after a day. If you add an email address for its alerts,
          it gets at most five, each marked as from a demo.
        </p>
      </Part>

      <Part title="Taking it, and deleting it">
        <p>
          In Settings you can download everything as spreadsheets, and delete your account. That
          deletes your workspace, products, rules, channels and alerts. A product page someone else
          also watches stays for them.
        </p>
      </Part>

      <Part title="Questions">
        <p>
          Ask in an issue on{' '}
          <a href="https://github.com/prabhjotsingh265/pennydrop/issues" className="underline">
            GitHub
          </a>
          , where Pennydrop is built in the open.
        </p>
      </Part>
    </PublicPage>
  );
}
