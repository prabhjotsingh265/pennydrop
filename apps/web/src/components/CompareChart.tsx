import { scaleLinear } from 'd3-scale';
import { curveStepAfter, line } from 'd3-shape';
import { useLayoutEffect, useRef, useState } from 'react';
import { spacedTicks } from '../lib/chart.ts';
import type { Series } from '../lib/compare.ts';
import { axisFormatter, formatMoney } from '../lib/money.ts';
import { priceAt } from './StepChart.tsx';

interface CompareChartProps {
  series: readonly Series[];
  domain: readonly [number, number];
  now: number;
  height: number;
  currency: string;
  /** The cheapest now, ringed in copper. */
  cheapestId: string | null;
  ticks: readonly number[];
  tickLabel: (t: number) => string;
  describeTime: (t: number) => string;
  label: string;
}

const MARGIN = { top: 16, right: 150, bottom: 30, left: 58 };
/** Below this width the end labels name the shop only: the table has the prices. */
const NARROW = 560;
/** End labels closer than this are nudged apart. */
const LABEL_GAP = 15;

const trim = (name: string, length: number) =>
  name.length > length ? `${name.slice(0, length - 1)}…` : name;

/** Labels at the right-hand end of each line, moved apart just enough not to overlap. */
export function spreadLabels(ys: readonly number[], gap = LABEL_GAP): number[] {
  const order = ys.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const item of order) {
    const previous = placed.at(-1);
    placed.push(previous === undefined ? item.y : Math.max(item.y, previous + gap));
  }
  const out = new Array<number>(ys.length);
  order.forEach((item, i) => (out[item.index] = placed[i]!));
  return out;
}

/** One step line per shop, each named at its end; your own listing in ink. */
export function CompareChart({
  series,
  domain,
  now,
  height,
  currency,
  cheapestId,
  ticks,
  tickLabel,
  describeTime,
  label,
}: CompareChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverT, setHoverT] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const drawn = series.filter((s) => s.points.length);
  const narrow = width < NARROW;
  const margin = { ...MARGIN, right: narrow ? 104 : MARGIN.right, left: narrow ? 48 : MARGIN.left };
  const innerWidth = Math.max(width - margin.left - margin.right, 0);
  const innerHeight = height - margin.top - margin.bottom;
  const prices = drawn.flatMap((s) => s.points.map((p) => p.price));
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const pad = (high - low) * 0.15 || 100;
  const x = scaleLinear().domain(domain).range([0, innerWidth]);
  const y = scaleLinear()
    .domain([low - pad, high + pad])
    .range([innerHeight, 0]);
  const path = line<{ t: number; price: number }>()
    .x((p) => x(p.t))
    .y((p) => y(p.price))
    .curve(curveStepAfter);

  // Each line from its first reading (or the window's start) to now: nothing before anything was seen.
  const lines = drawn.map((s) => {
    const start = Math.max(domain[0], s.points[0]!.t);
    const visible = [
      { t: start, price: priceAt(s.points, start) },
      ...s.points.filter((p) => p.t > start && p.t <= now),
      { t: now, price: priceAt(s.points, now) },
    ];
    return { series: s, visible, end: priceAt(s.points, now) };
  });
  const yTicks = y.ticks(4);
  const axisLabel = axisFormatter(currency, yTicks);
  const labelled = lines.filter((l) => !l.series.other);
  const labelYs = spreadLabels(labelled.map((l) => y(l.end)));
  const hovered =
    hoverT === null
      ? []
      : lines
          .filter((l) => l.series.points[0]!.t <= hoverT)
          .map((l) => ({ series: l.series, price: priceAt(l.series.points, hoverT) }))
          .sort((a, b) => a.price - b.price);

  return (
    <div ref={box} className="relative w-full" style={{ height }}>
      {width > 0 && drawn.length > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="block overflow-visible"
        >
          <g transform={`translate(${margin.left} ${margin.top})`}>
            {yTicks.map((tick) => (
              <g key={tick} transform={`translate(0 ${y(tick)})`}>
                <line x2={innerWidth} stroke="var(--line)" />
                <text
                  x={-12}
                  dy="0.32em"
                  textAnchor="end"
                  className="tabular fill-ink-2 text-[11px]"
                >
                  {axisLabel(tick)}
                </text>
              </g>
            ))}
            {spacedTicks(ticks, x).map((t) => (
              <text
                key={t}
                x={x(t)}
                y={innerHeight + 20}
                textAnchor="middle"
                className="tabular fill-ink-2 text-[11px]"
              >
                {tickLabel(t)}
              </text>
            ))}

            {/* Other shops first, faintly, so the named ones sit on top. */}
            {[...lines]
              .sort((a, b) => Number(b.series.other) - Number(a.series.other))
              .map(({ series: s, visible }) => (
                <path
                  key={s.watch.id}
                  d={path(visible) ?? ''}
                  fill="none"
                  stroke={s.colour}
                  strokeOpacity={s.other ? 0.35 : 1}
                  strokeWidth={s.mine ? 2.5 : 2}
                  strokeLinejoin="round"
                />
              ))}

            {labelled.map(({ series: s, end }, i) => {
              const cheapest = s.watch.id === cheapestId;
              return (
                <g key={s.watch.id}>
                  {cheapest && (
                    <circle
                      cx={x(now)}
                      cy={y(end)}
                      r={8}
                      fill="none"
                      stroke="var(--copper)"
                      strokeWidth={2.5}
                    />
                  )}
                  <circle cx={x(now)} cy={y(end)} r={4} fill={s.colour} />
                  <text
                    x={x(now) + 14}
                    y={labelYs[i]}
                    dy="0.32em"
                    className="tabular text-[11px] font-medium"
                    fill={s.colour}
                  >
                    {trim(s.name, narrow ? 11 : 20)}
                    {!narrow && <tspan className="fill-ink-2"> {formatMoney(end, currency)}</tspan>}
                  </text>
                </g>
              );
            })}

            <rect
              width={innerWidth}
              height={innerHeight}
              fill="transparent"
              onPointerMove={(event) => {
                const left = event.currentTarget.getBoundingClientRect().left;
                const t = x.invert(event.clientX - left);
                setHoverT(Math.min(Math.max(t, domain[0]), now));
              }}
              onPointerLeave={() => setHoverT(null)}
            />
            {hoverT !== null && (
              <line
                x1={x(hoverT)}
                x2={x(hoverT)}
                y2={innerHeight}
                stroke="var(--ink-2)"
                strokeOpacity={0.5}
                pointerEvents="none"
              />
            )}
          </g>
        </svg>
      )}
      {hoverT !== null && hovered.length > 0 && (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-[8px] border border-line bg-paper px-3 py-2 text-[12px] whitespace-nowrap shadow-sm"
          style={{ left: margin.left + x(hoverT) }}
        >
          <div className="mb-1 text-ink-2">{describeTime(hoverT)}</div>
          {hovered.map(({ series: s, price }) => (
            <div key={s.watch.id} className="tabular flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ background: s.colour }}
                  aria-hidden="true"
                />
                {s.name}
              </span>
              <span>{formatMoney(price, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
