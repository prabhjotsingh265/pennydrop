import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useRef, useState } from 'react';
import { PriceDigits } from '../components/PriceDigits.tsx';
import { StepChart, priceAt, type PricePoint } from '../components/StepChart.tsx';
import { formatMoney } from '../lib/money.ts';
import { useMediaQuery, useReducedMotion } from '../lib/motion.ts';
import { MockShop } from './MockShop.tsx';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Fickle's stoneware mug over thirty days. The shop redesigns on day 16 and
// starts a sale on day 26.
const DAY = 86_400_000;
const START = Date.UTC(2026, 8, 21);
const POINTS: PricePoint[] = [
  { t: 0, price: 4800 },
  { t: 5, price: 4650 },
  { t: 9, price: 4400 },
  { t: 13, price: 4450 },
  { t: 21, price: 4300 },
  { t: 26, price: 3400 },
];
const TARGET = 3500;
const WAS = 4800;
const REDESIGN_DAY = 16;
const SALE_DAY = 26;

const dayLabel = (day: number) =>
  new Date(START + day * DAY).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
const span = (p: number, from: number, to: number) => clamp((p - from) / (to - from));
const smooth = (t: number) => t * t * (3 - 2 * t);

type Status = 'idle' | 'checking' | 'found' | 'missing' | 'healed';

interface Strategy {
  name: string;
  status: Status;
  detail: string;
}

/** Everything on screen is a function of scroll progress, 0 to 1. */
function sceneAt(p: number) {
  const day =
    p < 0.3
      ? 1 + 15 * span(p, 0, 0.3)
      : p < 0.58
        ? REDESIGN_DAY
        : REDESIGN_DAY + 13 * span(p, 0.58, 0.86);
  const morph = smooth(span(p, 0.3, 0.4));
  const price = priceAt(POINTS, day);
  const sale = day >= SALE_DAY;

  const watch =
    p < 0.38
      ? ({ state: 'watching', heal: 0 } as const)
      : p < 0.54
        ? ({ state: 'lost', heal: 0 } as const)
        : ({ state: 'healed', heal: smooth(span(p, 0.54, 0.6)) } as const);

  const step = (at: number, done: number, missing: boolean): Status =>
    p < at ? 'idle' : p < done ? 'checking' : missing ? 'missing' : 'found';

  const strategies: Strategy[] = [
    {
      name: 'Saved selector',
      status: p < 0.38 ? 'found' : p < 0.56 ? 'missing' : 'healed',
      detail:
        p < 0.38
          ? `.price-now → ${formatMoney(price)}`
          : p < 0.56
            ? '.price-now matched nothing'
            : 'rewritten as [data-price]',
    },
    {
      name: 'Structured data',
      status: step(0.39, 0.42, true),
      detail: p < 0.39 ? 'not needed' : p < 0.42 ? 'reading JSON-LD…' : 'not on the new page',
    },
    {
      name: 'Microdata',
      status: step(0.42, 0.45, true),
      detail: p < 0.42 ? 'not needed' : p < 0.45 ? 'looking for itemprop="price"…' : 'none',
    },
    {
      name: 'Meta tags',
      status: step(0.45, 0.48, true),
      detail: p < 0.45 ? 'not needed' : p < 0.48 ? 'looking for product:price…' : 'none',
    },
    {
      name: 'Heuristics',
      status: step(0.48, 0.52, false),
      detail:
        p < 0.48
          ? 'not needed'
          : p < 0.52
            ? 'scoring price-shaped text…'
            : `${formatMoney(price)} · next to the title, largest on the page`,
    },
  ];

  const caption =
    p < 0.3
      ? 'Day by day, Pennydrop reads the price with the selector it saved.'
      : p < 0.4
        ? 'Then Fickle redesigns its product page.'
        : p < 0.56
          ? 'The saved selector finds nothing. The other strategies take over.'
          : p < 0.8
            ? 'Healed: a new selector, and the history carries on unbroken.'
            : 'Until the price drops through your target.';

  const log = [
    p >= 0.56 && {
      when: dayLabel(REDESIGN_DAY),
      text: 'Layout changed. Found the price another way.',
    },
    sale && {
      when: dayLabel(SALE_DAY),
      text: `Dropped to ${formatMoney(price)}. Under your ${formatMoney(TARGET)} target.`,
    },
  ].filter((entry): entry is { when: string; text: string } => Boolean(entry));

  return { day, morph, price, sale, watch, strategies, caption, log, toast: p >= 0.88 };
}

function StatusIcon({ status }: { status: Status }) {
  const common = 'size-4 shrink-0';
  if (status === 'idle')
    return (
      <svg viewBox="0 0 16 16" className={common} aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--line)" strokeWidth="1.5" />
      </svg>
    );
  if (status === 'checking')
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${common} animate-spin motion-reduce:animate-none`}
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--line)" strokeWidth="1.5" />
        <path
          d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
          fill="none"
          stroke="var(--copper)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  if (status === 'missing')
    return (
      <svg viewBox="0 0 16 16" className={common} aria-hidden="true">
        <path
          d="M5 5l6 6M11 5l-6 6"
          stroke="var(--danger)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={common} aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill={status === 'healed' ? 'var(--copper)' : 'var(--ink)'} />
      <path
        d="M5 8.2l2 2 4-4.4"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const STATUS_WORD: Record<Status, string> = {
  idle: 'not needed',
  checking: 'checking',
  found: 'found',
  missing: 'not found',
  healed: 'healed',
};

function Distance({ price }: { price: number }) {
  const above = price - TARGET;
  return (
    <div className="tabular text-[11px] text-ink-2">
      {above > 0 ? (
        <>
          {formatMoney(above)} above your {formatMoney(TARGET)} target
        </>
      ) : (
        <span className="text-copper-deep">
          ↓ {formatMoney(-above)} under your {formatMoney(TARGET)} target
        </span>
      )}
    </div>
  );
}

function Chart({ p, height }: { p: number; height: number }) {
  const scene = sceneAt(p);
  return (
    <StepChart
      points={POINTS}
      target={TARGET}
      domain={[0, 29]}
      now={scene.day}
      height={height}
      yDomain={[3200, 5000]}
      ticks={height < 170 ? [0, 14, 28] : [0, 7, 14, 21, 28]}
      tickLabel={dayLabel}
      events={p >= 0.4 ? [{ t: REDESIGN_DAY, label: 'Redesign' }] : []}
      label={`Price of the stoneware mug, now ${formatMoney(scene.price)}, target ${formatMoney(TARGET)}`}
    />
  );
}

function Alert({ price, shown }: { price: number; shown: boolean }) {
  return (
    <div
      className="rounded-[10px] border border-l-4 border-line border-l-copper bg-surface px-4 py-3 transition-[opacity,translate] duration-300"
      style={{ opacity: shown ? 1 : 0, translate: shown ? '0 0' : '0 12px' }}
      role="status"
    >
      <div className="text-[13px] font-medium">
        Dropped to {formatMoney(price)}. That's under your {formatMoney(TARGET)} target.
      </div>
      <div className="tabular mt-0.5 text-[11px] text-ink-2">
        Verified twice · sent to email and Slack
      </div>
    </div>
  );
}

/** Desktop: the full panel, every strategy listed, the log, the alert below. */
function Panel({ p }: { p: number }) {
  const scene = sceneAt(p);
  return (
    <div className="grid min-w-0 gap-4">
      <div className="min-w-0 rounded-[14px] border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <div className="text-sm font-medium">Stoneware mug, speckled</div>
            <div className="tabular text-[11px] text-ink-2">
              fickle · checked {dayLabel(Math.floor(scene.day))}
            </div>
          </div>
          <div className="text-right">
            <PriceDigits value={scene.price} className="text-[32px] font-medium" />
            <Distance price={scene.price} />
          </div>
        </div>

        <div className="-mx-2 mt-2">
          <Chart p={p} height={196} />
        </div>

        <ol className="mt-3 divide-y divide-line border-y border-line">
          {scene.strategies.map((strategy) => (
            <li key={strategy.name} className="flex min-w-0 items-center gap-3 py-2">
              <StatusIcon status={strategy.status} />
              <span
                className={`w-32 shrink-0 text-[13px] font-medium ${
                  // Greyed with a text colour, not opacity, so it still reads at 4.5:1.
                  strategy.status === 'idle' ? 'text-ink-2' : ''
                }`}
              >
                {strategy.name}
              </span>
              <span className="tabular min-w-0 truncate text-[11px] text-ink-2">
                <span className="sr-only">{STATUS_WORD[strategy.status]}: </span>
                {strategy.detail}
              </span>
            </li>
          ))}
        </ol>

        <ul className="mt-3 grid min-h-[44px] gap-1">
          {scene.log.map((entry) => (
            <li key={entry.when} className="flex gap-3 text-[12px]">
              <span className="tabular w-14 shrink-0 text-ink-2">{entry.when}</span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <Alert price={scene.price} shown={scene.toast} />
    </div>
  );
}

/**
 * Phones: one pinned screen can't hold the shop and the whole panel, so the
 * strategies fold into a row of icons with the active one spelled out, and
 * the alert takes their place when it fires.
 */
function CompactPanel({ p }: { p: number }) {
  const scene = sceneAt(p);
  // The one being tried right now; else a healed selector; else the last one tried.
  const shown =
    scene.strategies.find((s) => s.status === 'checking') ??
    scene.strategies.find((s) => s.status === 'healed') ??
    scene.strategies.findLast((s) => s.status !== 'idle') ??
    scene.strategies[0]!;

  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-surface p-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">Stoneware mug, speckled</div>
          <Distance price={scene.price} />
        </div>
        <PriceDigits value={scene.price} className="text-[26px] font-medium" />
      </div>
      <div className="-mx-2 mt-1">
        <Chart p={p} height={150} />
      </div>
      {scene.toast ? (
        <div className="mt-2 border-l-4 border-copper pl-3" role="status">
          <div className="text-[13px] font-medium">
            Dropped to {formatMoney(scene.price)}. Under your target.
          </div>
          <div className="tabular text-[11px] text-ink-2">
            Verified twice · sent to email and Slack
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex items-center gap-2" aria-hidden="true">
            {scene.strategies.map((strategy) => (
              <StatusIcon key={strategy.name} status={strategy.status} />
            ))}
          </div>
          <div className="mt-1.5 min-w-0 text-[12px]">
            <span className="font-medium">{shown.name}</span>{' '}
            <span className="tabular text-[11px] text-ink-2">
              <span className="sr-only">{STATUS_WORD[shown.status]}: </span>
              {shown.detail}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Frame({ p }: { p: number }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const scene = sceneAt(p);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] content-center gap-4 lg:gap-6">
      <p
        className="min-h-[2.5em] max-w-[34ch] text-[clamp(18px,2.2vw,30px)] leading-tight font-medium [font-stretch:105%]"
        aria-live="polite"
      >
        {scene.caption}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10">
        <MockShop
          morph={scene.morph}
          price={scene.price}
          was={scene.sale ? WAS : undefined}
          watch={scene.watch}
          showMarkup={wide}
        />
        {wide ? <Panel p={p} /> : <CompactPanel p={p} />}
      </div>
    </div>
  );
}

/** Signature moment 1: a pinned, scroll-driven redesign and recovery. */
export function RedesignScene() {
  const reduced = useReducedMotion();
  const section = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useGSAP(
    () => {
      if (reduced) return;
      const proxy = { p: 0 };
      gsap.to(proxy, {
        p: 1,
        ease: 'none',
        onUpdate: () => setProgress(proxy.p),
        scrollTrigger: {
          trigger: section.current,
          start: 'top top',
          end: () => `+=${window.innerHeight * 3.2}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
    },
    { dependencies: [reduced], scope: section, revertOnUpdate: true },
  );

  if (reduced) {
    return (
      <div className="grid gap-16 px-[max(16px,4vw)] py-10">
        {[0.2, 0.6, 1].map((p) => (
          <Frame key={p} p={p} />
        ))}
      </div>
    );
  }

  return (
    <div ref={section} className="relative h-dvh overflow-hidden px-[max(16px,4vw)] py-4 lg:py-8">
      <Frame p={progress} />
      <div
        className="pointer-events-none absolute inset-x-[max(16px,4vw)] bottom-4 h-0.5 bg-line"
        aria-hidden="true"
      >
        <div
          className="h-full origin-left bg-copper"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  );
}
