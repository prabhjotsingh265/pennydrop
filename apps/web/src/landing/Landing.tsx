import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useReducedMotion } from '../lib/motion.ts';
import { useTitle } from '../lib/title.ts';
import { buttonClass } from '../ui/Button.tsx';
import { Footer, Header } from './PublicChrome.tsx';
import { RedesignScene } from './RedesignScene.tsx';
import { TargetPlayground } from './TargetPlayground.tsx';
import { Watchlist } from './Watchlist.tsx';

gsap.registerPlugin(useGSAP);

function Hero() {
  const reduced = useReducedMotion();
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (reduced) return;
      const slot = scope.current?.querySelector('.hero-slot');
      const flash = () => {
        slot?.classList.remove('slot-flash');
        void slot?.getBoundingClientRect();
        slot?.classList.add('slot-flash');
      };
      gsap
        .timeline({ delay: 0.35 })
        .from('.hero-coin', {
          y: () => -window.innerHeight * 0.75,
          duration: 0.85,
          ease: 'power2.in',
        })
        .call(flash, [], 0.72)
        .to('.hero-coin', { y: -16, duration: 0.17, ease: 'power2.out' })
        .to('.hero-coin', { y: 0, duration: 0.17, ease: 'power2.in' })
        .to('.hero-coin', { y: -4, duration: 0.09, ease: 'power2.out' })
        .to('.hero-coin', { y: 0, duration: 0.09, ease: 'power2.in' });
    },
    { scope, dependencies: [reduced] },
  );

  return (
    <section
      ref={scope}
      className="relative flex min-h-dvh flex-col justify-end overflow-hidden px-[max(16px,4vw)] pt-28 pb-14"
    >
      <h1 className="text-[clamp(50px,10.4vw,172px)] leading-[0.9] font-bold tracking-[-0.035em] [font-stretch:112%]">
        Know when the <br className="hidden sm:block" />
        penny drops.
      </h1>

      {/* The target line, page wide, with the slot the coin falls through. */}
      <div className="hero-slot slot relative mt-10 h-28 sm:mt-14">
        <div className="absolute top-0 left-0 h-[3px] w-[calc(76%-48px)] rounded-full bg-copper" />
        <div className="absolute top-0 right-0 h-[3px] w-[calc(24%-48px)] rounded-full bg-copper" />
        <span className="slot-glint absolute -top-[3px] left-[calc(76%-48px)] size-[9px] -translate-x-1/2 rounded-full bg-copper" />
        <span className="slot-glint absolute -top-[3px] left-[calc(76%+48px)] size-[9px] -translate-x-1/2 rounded-full bg-copper" />
        <div
          className="hero-coin absolute top-[10px] left-[76%] size-[72px] -translate-x-1/2 rounded-full bg-copper"
          style={{
            boxShadow:
              'inset 0 0 0 10px var(--copper), inset 0 0 0 12px color-mix(in oklab, var(--on-copper) 30%, transparent)',
          }}
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="max-w-[44ch] text-[clamp(17px,1.5vw,21px)] leading-snug text-ink-2">
            Price monitoring that notices when a shop redesigns its page, and keeps going.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/demo" className={buttonClass('primary', 'h-11 px-5 text-[15px]')}>
              Try the demo
            </Link>
            <Link to="/signup" className={buttonClass('quiet', 'h-11 px-5 text-[15px]')}>
              Create an account
            </Link>
            <span className="text-[13px] text-ink-2">The demo needs no account.</span>
          </div>
        </div>
        <p className="tabular text-[11px] text-ink-2">Scroll: a shop redesigns itself ↓</p>
      </div>
    </section>
  );
}

function Section({
  n,
  title,
  lead,
  children,
  flush = false,
}: {
  n: string;
  title: string;
  lead: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="border-t border-line pt-20">
      <header className="mb-10 grid gap-3 px-[max(16px,4vw)] md:grid-cols-[120px_minmax(0,1fr)]">
        <span className="tabular pt-3 text-[12px] text-copper-deep">{n}</span>
        <div>
          <h2 className="text-[clamp(32px,4.4vw,64px)] leading-[0.95] font-semibold tracking-[-0.025em] [font-stretch:108%]">
            {title}
          </h2>
          <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">{lead}</p>
        </div>
      </header>
      <div className={flush ? '' : 'px-[max(16px,4vw)] pb-24'}>{children}</div>
    </section>
  );
}

/** What it does behind the scenes, in claims the code backs. */
const FACTS = [
  {
    title: 'Polite to every shop',
    text: 'It obeys robots.txt and its crawl delay, asks a real shop at most once every 10 seconds, and when a shop struggles, a circuit breaker leaves it alone for a while.',
  },
  {
    title: 'Read five ways',
    text: 'The saved selector, the page’s structured data, its microdata, its meta tags, and a scorer for price-shaped text. When the selector breaks, the others find the price and teach it a new one.',
  },
  {
    title: 'Alerts that don’t cry wolf',
    text: 'Each change alerts each channel once, however many workers see it. A jump of more than half is checked twice first, and a price wobbling round your target alerts once.',
  },
  {
    title: 'Honest history',
    text: 'Prices are drawn as the steps they took, never slopes. A sale’s “was” price is checked against what the shop really charged in the 30 days before.',
  },
  {
    title: 'Where you are',
    text: 'Email, Slack, Discord, or a signed webhook to your own systems. Quiet hours, or one summary a day.',
  },
  {
    title: 'Yours to take',
    text: 'Download everything as spreadsheets, or delete your account, any time. One session cookie, and nothing that tracks you.',
  },
];

/** The front page: the idea, the redesign told by the scroll, and the way in. */
export function Landing() {
  useTitle('Pennydrop: price monitoring that keeps going');
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <Header overlay />

      <main>
        <Hero />

        <Section
          n="01"
          title="The redesign"
          lead="Keep scrolling. Halfway through, the shop rebuilds its product page. Pennydrop loses the price, finds it another way, rewrites its selector and carries on, and the price history never breaks."
          flush
        >
          <RedesignScene />
        </Section>

        <Section
          n="02"
          title="Your target"
          lead="The card's colour isn't picked: it's computed from how close the price is to your target, blended from slate to copper. Drag the copper line to move your target; press Next check to move the price. When it drops through, so does the coin."
        >
          <TargetPlayground />
        </Section>

        <Section
          n="03"
          title="The watchlist"
          lead="Every card is tinted by its distance to target, so the list reads as a map of where the deals are. Prices roll the way they move. The last-checked chip turns from copper to verdigris as a reading gets stale."
        >
          <Watchlist />
        </Section>

        <Section
          n="04"
          title="Built to be trusted"
          lead="The hard part of watching prices isn't reading one page. It's reading thousands, every few hours, for months, without being a nuisance or crying wolf."
        >
          <ul className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FACTS.map((fact) => (
              <li key={fact.title} className="border-t border-line pt-5">
                <h3 className="text-[17px] font-semibold">{fact.title}</h3>
                <p className="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-ink-2">
                  {fact.text}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <section className="border-t border-line px-[max(16px,4vw)] py-24">
          <h2 className="max-w-[16ch] text-[clamp(32px,4.4vw,64px)] leading-[0.95] font-semibold tracking-[-0.025em] [font-stretch:108%]">
            Break a shop, and watch it recover.
          </h2>
          <p className="mt-5 max-w-[56ch] text-[16px] leading-relaxed text-ink-2">
            The demo gives you products with weeks of history and a practice shop of your own:
            redesign it, slow it down, knock it over or start a sale, and see what Pennydrop makes
            of it. No account needed; it’s gone after a day.
          </p>
          <Link to="/demo" className={buttonClass('primary', 'mt-8 h-11 px-5 text-[15px]')}>
            Try the demo
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  );
}
