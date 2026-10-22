import { Link } from 'react-router';
import { Part, PublicPage } from './PublicChrome.tsx';

const code = 'tabular rounded-[6px] bg-surface px-1.5 py-0.5 text-[13px]';
const list = 'list-disc space-y-1.5 pl-5';

/** For site owners: who our crawler is, what it respects, and how to turn it away. */
export function BotPage() {
  return (
    <PublicPage title="Our crawler" updated="22 October 2026">
      <p className="text-[17px]">
        If you run a shop and see <code className={code}>PennydropBot</code> in your logs: it’s
        reading the price of a product someone asked Pennydrop to watch, and it tries hard to be a
        good guest.
      </p>

      <Part title="How it introduces itself">
        <p>Every request carries this user agent:</p>
        <p>
          <code className={code}>
            PennydropBot/0.1 (+https://pennydrop.ingenio-algomancer.com/bot)
          </code>
        </p>
      </Part>

      <Part title="What it respects">
        <ul className={list}>
          <li>
            <strong>robots.txt</strong>, read under the token{' '}
            <code className={code}>PennydropBot</code> and kept for a day. If it says no, we don’t
            fetch the page. If your robots.txt answers with a server error, or doesn’t answer, we
            treat every page as off limits until it does (as RFC 9309 asks).
          </li>
          <li>
            <strong>Crawl-delay.</strong> Otherwise, at most one request to your site every 10
            seconds, one at a time, however many people watch your products. A page several people
            watch is fetched once.
          </li>
          <li>
            <strong>429 and Retry-After.</strong> We stop asking your whole site until the time you
            gave us.
          </li>
          <li>
            <strong>Trouble.</strong> When your site keeps failing, a circuit breaker leaves it
            alone, for five minutes at first and up to six hours.
          </li>
          <li>
            <strong>“Not modified”.</strong> We send the ETag and Last-Modified you gave us, so an
            unchanged page costs you almost nothing.
          </li>
        </ul>
      </Part>

      <Part title="What it reads, and what it doesn’t">
        <p>
          The price, a “was” price, the currency, whether it’s in stock, and the page’s title.
          Nothing personal, nothing behind a login, nothing else. Some pages only show their price
          after their scripts run; those are read in a real browser, with the same rules.
        </p>
        <p>
          It never tries to get round a block: no CAPTCHA solving, no disguised browsers, no
          rotating addresses. If your site turns us away, we tell the person watching and look again
          only once a day, in case you change your mind.
        </p>
      </Part>

      <Part title="How to turn it away">
        <p>Add this to your robots.txt, and we stop within a day:</p>
        <pre className="tabular overflow-x-auto rounded-[8px] bg-surface p-4 text-[13px]">
          {'User-agent: PennydropBot\nDisallow: /'}
        </pre>
        <p>
          Or turn away just part of your site with a narrower <code className={code}>Disallow</code>
          , or slow us down with <code className={code}>Crawl-delay</code>.
        </p>
      </Part>

      <Part title="Questions">
        <p>
          Pennydrop is built in the open. Ask anything, or tell us we got something wrong, in an
          issue on{' '}
          <a href="https://github.com/prabhjotsingh265/pennydrop/issues" className="underline">
            GitHub
          </a>
          . And see{' '}
          <Link to="/privacy" className="underline">
            privacy
          </Link>{' '}
          for what we keep.
        </p>
      </Part>
    </PublicPage>
  );
}
