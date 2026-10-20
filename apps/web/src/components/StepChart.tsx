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
import { formatMoney } from '../lib/money.ts';
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
  target: number;
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
  label,
}: StepChartProps) {
  const reduced = useReducedMotion();
  const fadeId = useId();
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const coinRef = useRef<SVGGElement>(null);
  const slotRef = useRef<SVGGElement>(null);

  const margin = compact
    ? { top: 8, right: 10, bottom: 8, left: 4 }
    : { top: 28, right: 28, bottom: 30, left: 58 };
  const innerWidth = Math.max(width - margin.left - margin.right, 0);
  const innerHeight = height - margin.top - margin.bottom;
  const radius = compact ? 4.5 : 9;

  const prices = points.map((p) => p.price).concat(target);
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
  const visible = [
    { t: domain[0], price: priceAt(points, domain[0]) },
    ...points.filter((p) => p.t > domain[0] && p.t <= now),
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
  const targetY = y(target);

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

  const yTicks = compact ? [] : y.ticks(4);
  const axisMoney = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });

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
    if (!onTargetChange) return;
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
            {yTicks.map((tick) => (
              <g key={tick} transform={`translate(0 ${y(tick)})`}>
                <line x2={innerWidth} stroke="var(--line)" />
                <text
                  x={-12}
                  dy="0.32em"
                  textAnchor="end"
                  className="tabular fill-ink-2 text-[11px]"
                >
                  {axisMoney.format(tick / 100)}
                </text>
              </g>
            ))}
            {!compact &&
              ticks.map((t) => (
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

            {events.map((event) =>
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

            {onTargetChange && (
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
    </div>
  );
}
