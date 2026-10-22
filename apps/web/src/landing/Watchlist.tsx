import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PriceDigits } from '../components/PriceDigits.tsx';
import { StepChart, type PricePoint } from '../components/StepChart.tsx';
import { formatMoney } from '../lib/money.ts';
import { useReducedMotion } from '../lib/motion.ts';
import { useTheme } from '../lib/theme.ts';
import { distanceFromTarget, patina, proximityTint } from '../lib/tint.ts';

gsap.registerPlugin(Flip);

/** Times are in hours on a simulated clock; the sparklines show thirty days. */
const WINDOW = 720;
const TICK_HOURS = 0.15;

interface Item {
  id: string;
  name: string;
  shop: string;
  target: number;
  /** Hours between checks. */
  every: number;
  history: PricePoint[];
  checkedAt: number;
  /** The prices the next checks will find, in order. Empty: it never changes. */
  upcoming: number[];
}

function seededHistory(seed: number, start: number, until: number): PricePoint[] {
  let s = seed;
  const random = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const points: PricePoint[] = [{ t: 0, price: start }];
  let price = start;
  for (let t = 40 + random() * 90; t < until; t += 50 + random() * 120) {
    price = Math.round((price * (0.93 + random() * 0.12)) / 10) * 10;
    points.push({ t, price });
  }
  return points;
}

const NOW = WINDOW;

function item(
  id: string,
  name: string,
  shop: string,
  target: number,
  start: number,
  every: number,
  upcoming: number[],
  checkedHoursAgo: number,
  seed: number,
): Item {
  const history = upcoming.length ? seededHistory(seed, start, NOW - 20) : [{ t: 0, price: start }];
  return { id, name, shop, target, every, history, upcoming, checkedAt: NOW - checkedHoursAgo };
}

const INITIAL: Item[] = [
  item('lamp', 'Brass desk lamp', 'fickle', 5500, 6400, 1, [6200, 5900, 6100, 5400], 0.2, 11),
  item('apron', 'Linen apron', 'fickle', 2200, 2500, 1, [2450, 2390, 2150, 2300], 0.6, 23),
  item(
    'board',
    'Walnut chopping board',
    'slowpoke',
    3000,
    4400,
    1,
    [4200, 4050, 3900, 3700],
    0.9,
    37,
  ),
  item('attic', 'A Light in the Attic', 'books.toscrape', 4500, 5177, 6, [], 4.5, 41),
  item(
    'pourover',
    'Ceramic pour-over set',
    'brittle',
    3800,
    4100,
    1,
    [3950, 3890, 3790, 3990],
    1.4,
    53,
  ),
  item('colander', 'Enamel colander', 'fickle', 1800, 2700, 1, [2600, 2650, 2490, 2400], 0.4, 67),
  item('kettle', 'Cast-iron kettle', 'slowpoke', 7200, 7600, 1, [7450, 7390, 7290, 7150], 1.8, 79),
  item('mat', 'Felt desk mat', 'brittle', 1500, 1600, 1, [1480, 1520, 1440, 1490], 0.1, 83),
];

const current = (it: Item) => it.history[it.history.length - 1]!.price;
const byCloseness = (a: Item, b: Item) =>
  distanceFromTarget(current(a), a.target) - distanceFromTarget(current(b), b.target);

function ago(hours: number) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  return `${Math.round(hours)} h ago`;
}

function Card({ it, now }: { it: Item; now: number }) {
  const [theme] = useTheme();
  const price = current(it);
  const above = price - it.target;
  const age = (now - it.checkedAt) / it.every;

  return (
    <article
      data-card={it.id}
      className="flex flex-col rounded-[14px] border border-line p-4 transition-[background-color] duration-700"
      style={{ backgroundColor: proximityTint(distanceFromTarget(price, it.target), theme) }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-medium">{it.name}</h3>
          <div className="tabular text-[10px] text-ink-2">{it.shop}</div>
        </div>
        <span
          className="tabular inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper/60 px-2 py-0.5 text-[10px]"
          style={{ color: patina(age) }}
          title="Copper when fresh, verdigris when stale"
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: patina(age) }}
            aria-hidden="true"
          />
          {ago(now - it.checkedAt)}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <PriceDigits value={price} className="text-[26px] leading-none font-medium" />
        <div className="tabular text-right text-[10px] leading-4 text-ink-2">
          target {formatMoney(it.target)}
          <br />
          {above > 0 ? (
            <>{formatMoney(above)} above</>
          ) : (
            <span className="font-semibold text-copper-deep">↓ {formatMoney(-above)} under</span>
          )}
        </div>
      </div>

      <div className="-mx-1 mt-2">
        <StepChart
          compact
          points={it.history}
          target={it.target}
          domain={[now - WINDOW, now]}
          now={now}
          height={64}
          label={`${it.name}: ${formatMoney(price)}, target ${formatMoney(it.target)}`}
        />
      </div>
    </article>
  );
}

export function Watchlist() {
  const reduced = useReducedMotion();
  const grid = useRef<HTMLDivElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const [items, setItems] = useState(INITIAL);
  const [now, setNow] = useState(NOW);
  const [turn, setTurn] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [visible, setVisible] = useState(false);

  const capture = () => {
    if (grid.current && !reduced)
      flipState.current = Flip.getState(grid.current.querySelectorAll('[data-card]'));
  };

  // One product is checked per tick, round the list; the clock moves on nine minutes.
  const tick = () => {
    capture();
    const t = now + TICK_HOURS;
    const changing = items.filter((it) => it.upcoming.length);
    const chosen = changing[turn % changing.length]!;
    setItems((list) =>
      list.map((it) => {
        if (it.id !== chosen.id) return it;
        const [next, ...rest] = it.upcoming;
        const history =
          next !== undefined && next !== current(it)
            ? [...it.history, { t, price: next }]
            : it.history;
        return {
          ...it,
          history,
          checkedAt: t,
          upcoming: next === undefined ? [] : [...rest, next],
        };
      }),
    );
    setNow(t);
    setTurn((n) => n + 1);
  };

  const sale = () => {
    capture();
    const t = now + TICK_HOURS;
    const shoppers = [...items]
      .filter((it) => it.upcoming.length && current(it) > it.target)
      .sort(byCloseness)
      .slice(0, 3);
    setItems((list) =>
      list.map((it) =>
        shoppers.some((s) => s.id === it.id)
          ? {
              ...it,
              history: [...it.history, { t, price: Math.round((it.target * 0.92) / 10) * 10 }],
              checkedAt: t,
            }
          : it,
      ),
    );
    setNow(t);
  };

  useLayoutEffect(() => {
    if (!flipState.current) return;
    Flip.from(flipState.current, { duration: 0.7, ease: 'power3.inOut' });
    flipState.current = null;
  }, [items]);

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(Boolean(entry?.isIntersecting)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    const id = window.setTimeout(tick, 2400);
    return () => window.clearTimeout(id);
  });

  const sorted = [...items].sort(byCloseness);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="rounded-[8px] border border-line bg-surface px-3.5 py-2 text-sm font-medium"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={tick}
          className="rounded-[8px] border border-line bg-surface px-3.5 py-2 text-sm font-medium"
        >
          Check one now
        </button>
        <button
          type="button"
          onClick={sale}
          className="rounded-[8px] bg-copper px-3.5 py-2 text-sm font-medium text-on-copper"
        >
          Run a sale
        </button>
        <span className="tabular text-[11px] text-ink-2">
          Sorted by closest to target · simulated clock, 9 minutes a tick
        </span>
      </div>
      <div ref={grid} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sorted.map((it) => (
          <Card key={it.id} it={it} now={now} />
        ))}
      </div>
    </div>
  );
}
