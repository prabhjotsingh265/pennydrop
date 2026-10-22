import { scaleLinear } from 'd3-scale';
import { area, curveStepAfter, line } from 'd3-shape';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useCoinPhysics } from '../lib/coin.ts';
import { axisFormatter, formatMoney } from '../lib/money.ts';
import { spacedTicks } from '../lib/chart.ts';
import { useReducedMotion } from '../lib/motion.ts';

export interface PricePoint {
  t: number;
  /** Whole minor units. */
  price: number;
}

export interface ChartEvent {
  t: number;
  label: string;
}

interface StepChartProps {
  /** Change points, sorted by time: each price holds until the next one. */
  points: readonly PricePoint[];
  /** No target: no slot is drawn. */
  target?: number | null;
  domain: readonly [number, number];
  /** The line is drawn up to here; the coin sits at its end. */
  now: number;
  height: number;
  yDomain?: readonly [number, number];
  events?: readonly ChartEvent[];
  ticks?: readonly number[];
  tickLabel?: (t: number) => string;
  currency?: string;
  compact?: boolean;
  /** Makes the target slot draggable. */
  onTargetChange?: (price: number) => void;
  targetStep?: number;
  /** Stretches to hatch: when the product was out of stock. */
  bands?: readonly { from: number; to: number }[];
  /** Moments a check failed: small ticks along the time axis. */
  failures?: readonly number[];
  /** Turns on the hover readout; says when a moment was, in words. */
  describeTime?: (t: number) => string;
  label: string;
}

export function priceAt(points: readonly PricePoint[], t: number): number {
  let price = points[0]?.price ?? 0;
  for (const point of points) {
    if (point.t > t) break;
    price = point.price;
  }
  return price;
}

/** The price in force at a moment, and how far it moved from the step before. */
export function stepAt(points: readonly PricePoint[], t: number) {
  const index = points.findLastIndex((p) => p.t <= t);
  const point = points[Math.max(index, 0)];
  if (!point) return null;
  const before = index > 0 ? points[index - 1] : undefined;
  return { price: point.price, change: before ? point.price - before.price : null };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function StepChart({
  points,
  target,
  domain,
  now,
  height,
  yDomain,
  events = [],
  ticks = [],
  tickLabel,
  currency = 'GBP',
  compact = false,
  onTargetChange,
  targetStep = 50,
  bands = [],
  failures = [],
  describeTime,
  label,
}: StepChartProps) {
  const reduced = useReducedMotion();
  const fadeId = useId();
  const hatchId = useId();
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const coinRef = useRef<SVGGElement>(null);
  const slotRef = useRef<SVGGElement>(null);

  const margin = compact
    ? { top: 8, right: 10, bottom: 8, left: 4 }
    : { top: 28, right: 28, bottom: 30, left: 58 };
  const innerWidth = Math.max(width - margin.left - margin.right, 0);
  const innerHeight = height - margin.top - margin.bottom;
  const radius = compact ? 4.5 : 9;

  const prices = points.map((p) => p.price).concat(target ?? []);
  const [low, high] = yDomain ?? [Math.min(...prices), Math.max(...prices)];
  // A given range is drawn as given; a derived one gets breathing room.
  const pad = yDomain ? 0 : (high - low) * 0.18 || 100;
  const gap = radius * 2 + 8;
  // "Now" stops short of the right edge, so the slot always shows both sides.
  const x = scaleLinear()
    .domain(domain)
    .range([0, Math.max(innerWidth - gap, 0)]);
  const y = scaleLinear()
    .domain([low - pad, high + pad])
    .range([innerHeight, 0]);

  const current = priceAt(points, now);
  // Drawn from the left edge of the window, starting at the price in force
  // there; anything older would land off the chart.
  // Drawn from the left edge of the window, or from the first reading if that came later:
  // a line before anything was seen would claim a price nobody saw.
  const start = Math.max(domain[0], points[0]?.t ?? domain[0]);
  const visible = [
    { t: start, price: priceAt(points, start) },
    ...points.filter((p) => p.t > start && p.t <= now),
    { t: now, price: current },
  ];
  const stepLine = line<PricePoint>()
    .x((p) => x(p.t))
    .y((p) => y(p.price))
    .curve(curveStepAfter);
  const stepArea = area<PricePoint>()
    .x((p) => x(p.t))
    .y0(innerHeight)
    .y1((p) => y(p.price))
    .curve(curveStepAfter);

  const coinX = x(now);
  const coinY = y(current);
  const targetY = target == null ? Number.NaN : y(target);

  // The coin's x follows the line directly; its y goes through the physics.
  const place = useRef({ x: coinX, targetY, lastY: coinY });
  const onFrame = useCallback((cy: number) => {
    const p = place.current;
    coinRef.current?.setAttribute('transform', `translate(${p.x} ${cy})`);
    // Falling through the target line: the slot catches the light.
    if (p.lastY < p.targetY && cy >= p.targetY && slotRef.current) {
      const slot = slotRef.current;
      slot.classList.remove('slot-flash');
      void slot.getBoundingClientRect();
      slot.classList.add('slot-flash');
    }
    p.lastY = cy;
  }, []);
  const coin = useCoinPhysics(coinY, onFrame, reduced);

  useLayoutEffect(() => {
    place.current.x = coinX;
    place.current.targetY = targetY;
    coinRef.current?.setAttribute('transform', `translate(${coinX} ${coin.current.y})`);
  }, [coinX, targetY, coin]);

  // Flags too close to read apart are drawn once: two heals minutes apart are one story.
  const flagTimes = spacedTicks(
    [...events].sort((a, b) => a.t - b.t).map((event) => event.t),
    x,
    56,
  );
  const flags = flagTimes.map((t) => events.find((event) => event.t === t)!);
  const yTicks = compact ? [] : y.ticks(4);
  const axisLabel = axisFormatter(currency, yTicks);
  const hovered = hoverT === null ? null : stepAt(points, hoverT);

  const dragTo = (clientY: number, element: Element) => {
    if (!onTargetChange) return;
    const top = element.getBoundingClientRect().top + margin.top;
    const price = y.invert(clientY - top);
    onTargetChange(Math.max(targetStep, Math.round(price / targetStep) * targetStep));
  };
  const onPointerDown = (event: PointerEvent<SVGElement>) => {
    if (!onTargetChange) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragTo(event.clientY, event.currentTarget.ownerSVGElement ?? event.currentTarget);
  };
  const onPointerMove = (event: PointerEvent<SVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      dragTo(event.clientY, event.currentTarget.ownerSVGElement ?? event.currentTarget);
    }
  };
  const onKeyDown = (event: KeyboardEvent<SVGElement>) => {
    if (!onTargetChange || target == null) return;
    const step = event.shiftKey || event.key.startsWith('Page') ? targetStep * 10 : targetStep;
    const moves: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      PageUp: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageDown: -step,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    onTargetChange(Math.max(targetStep, target + move));
  };

  return (
    <div ref={boxRef} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="block overflow-visible"
        >
          <g transform={`translate(${margin.left} ${margin.top})`}>
            {bands.length > 0 && (
              <defs>
                <pattern
                  id={hatchId}
                  width={6}
                  height={6}
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line y2={6} stroke="var(--ink)" strokeOpacity={0.18} strokeWidth={1.5} />
                </pattern>
              </defs>
            )}
            {failures
              .filter((t) => t >= domain[0] && t <= now)
              .map((t) => (
                <line
                  key={`fail-${t}`}
                  x1={x(t)}
                  x2={x(t)}
                  y1={innerHeight - 6}
                  y2={innerHeight}
                  stroke="var(--danger)"
                  strokeWidth={1.5}
                />
              ))}
            {bands.map((band) => {
              const from = x(Math.max(band.from, domain[0]));
              const to = x(Math.min(band.to, now));
              return to > from ? (
                <rect
                  key={band.from}
                  x={from}
                  width={to - from}
                  height={innerHeight}
                  fill={`url(#${CSS.escape(hatchId)})`}
                />
              ) : null;
            })}
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
            {!compact &&
              spacedTicks(ticks, x).map((t) => (
                <text
                  key={t}
                  x={x(t)}
                  y={innerHeight + 20}
                  textAnchor="middle"
                  className="tabular fill-ink-2 text-[11px]"
                >
                  {tickLabel?.(t) ?? t}
                </text>
              ))}

            {flags.map((event) =>
              event.t <= now ? (
                <g
                  key={event.t + event.label}
                  transform={`translate(${x(event.t)} 0)`}
                  className="chart-flag"
                >
                  <line
                    y1={-10}
                    y2={innerHeight}
                    stroke="var(--ink-2)"
                    strokeDasharray="2 4"
                    opacity={0.6}
                  />
                  <text y={-14} textAnchor="middle" className="fill-ink-2 text-[11px] font-medium">
                    {event.label}
                  </text>
                </g>
              ) : null,
            )}

            {!compact && (
              <>
                <defs>
                  <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.07} />
                    <stop offset="100%" stopColor="var(--ink)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path d={stepArea(visible) ?? ''} fill={`url(#${CSS.escape(fadeId)})`} />
              </>
            )}
            <path
              d={stepLine(visible) ?? ''}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={compact ? 1.5 : 2}
              strokeLinejoin="round"
            />

            {/* The target: a slot with a gap where the coin passes through. */}
            {target != null && (
              <g ref={slotRef} className="slot">
                <line
                  x2={Math.max(coinX - gap / 2, 0)}
                  y1={targetY}
                  y2={targetY}
                  stroke="var(--copper)"
                  strokeWidth={compact ? 1.5 : 2}
                />
                <line
                  x1={Math.min(coinX + gap / 2, innerWidth)}
                  x2={innerWidth}
                  y1={targetY}
                  y2={targetY}
                  stroke="var(--copper)"
                  strokeWidth={compact ? 1.5 : 2}
                />
                <circle
                  className="slot-glint"
                  cx={coinX - gap / 2}
                  cy={targetY}
                  r={2.5}
                  fill="var(--copper)"
                />
                <circle
                  className="slot-glint"
                  cx={coinX + gap / 2}
                  cy={targetY}
                  r={2.5}
                  fill="var(--copper)"
                />
                {!compact && (
                  <text
                    x={0}
                    y={targetY - 8}
                    className="tabular fill-copper-deep text-[11px] font-medium"
                  >
                    Target {formatMoney(target, currency)}
                  </text>
                )}
              </g>
            )}

            {describeTime && (
              <rect
                width={Math.max(innerWidth - gap, 0)}
                height={innerHeight}
                fill="transparent"
                onPointerMove={(event) => {
                  const left = event.currentTarget.getBoundingClientRect().left;
                  const t = x.invert(event.clientX - left);
                  // Before the first reading there's nothing to tell.
                  setHoverT(t < start ? null : Math.min(t, now));
                }}
                onPointerLeave={() => setHoverT(null)}
              />
            )}
            {hoverT !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(hoverT)}
                  x2={x(hoverT)}
                  y2={innerHeight}
                  stroke="var(--ink-2)"
                  strokeOpacity={0.5}
                />
                <circle cx={x(hoverT)} cy={y(priceAt(points, hoverT))} r={4} fill="var(--ink)" />
              </g>
            )}

            {onTargetChange && target != null && (
              <line
                x2={innerWidth}
                y1={targetY}
                y2={targetY}
                stroke="transparent"
                strokeWidth={24}
                className="cursor-ns-resize focus:outline-none"
                tabIndex={0}
                role="slider"
                aria-label="Target price"
                aria-valuenow={target}
                aria-valuetext={formatMoney(target, currency)}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onKeyDown={onKeyDown}
              />
            )}

            {/* Positioned only by the physics and the layout effect, never by a
                render: React would otherwise snap it to its resting place mid-fall. */}
            <g ref={coinRef} pointerEvents="none">
              <circle r={radius} fill="var(--copper)" />
              <circle
                r={radius * 0.68}
                fill="none"
                stroke="var(--on-copper)"
                strokeOpacity={0.35}
                strokeWidth={compact ? 0.8 : 1.25}
              />
            </g>
          </g>
        </svg>
      )}
      {hoverT !== null && hovered && describeTime && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[8px] border border-line bg-paper px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-sm"
          style={{ left: margin.left + x(hoverT), top: margin.top + y(hovered.price) - 12 }}
        >
          <div className="tabular font-medium">{formatMoney(hovered.price, currency)}</div>
          {hovered.change !== null && hovered.change !== 0 && (
            <div className="tabular text-ink-2">
              {hovered.change < 0 ? '↓' : '↑'} {formatMoney(Math.abs(hovered.change), currency)}{' '}
              from before
            </div>
          )}
          <div className="text-ink-2">{describeTime(hoverT)}</div>
        </div>
      )}
    </div>
  );
}
