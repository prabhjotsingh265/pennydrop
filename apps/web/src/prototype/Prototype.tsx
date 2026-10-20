import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, type ReactNode } from 'react';
import { BrandMark } from '../components/BrandMark.tsx';
import { useReducedMotion } from '../lib/motion.ts';
import { useTheme } from '../lib/theme.ts';
import { RedesignScene } from './RedesignScene.tsx';
import { TargetPlayground } from './TargetPlayground.tsx';
import { Watchlist } from './Watchlist.tsx';

gsap.registerPlugin(useGSAP);

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="tabular rounded-full border border-line bg-surface px-3 py-1.5 text-[11px]"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  );
}

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
        <p className="max-w-[44ch] text-[clamp(17px,1.5vw,21px)] leading-snug text-ink-2">
          Price monitoring that notices when a shop redesigns its page, and keeps going.
        </p>
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

export function Prototype() {
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-[max(16px,4vw)] py-5">
        <a href="/prototype" className="flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="text-[17px] font-semibold tracking-[-0.01em] [font-stretch:110%]">
            Pennydrop
          </span>
        </a>
        <div className="flex items-center gap-3">
          <span className="tabular hidden text-[11px] text-ink-2 sm:inline">Design prototype</span>
          <ThemeToggle />
        </div>
      </header>

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
      </main>

      <footer className="tabular border-t border-line px-[max(16px,4vw)] py-8 text-[11px] text-ink-2">
        Pennydrop · design prototype · Mona Sans and Martian Mono · colours computed in OKLCH
      </footer>
    </div>
  );
}
