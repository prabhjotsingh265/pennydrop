import type { SystemView } from '@pennydrop/domain';
import { scaleLinear } from 'd3-scale';
import { useLayoutEffect, useRef, useState } from 'react';

const MINUTE = 60_000;
const SLOTS = 60;
const HEIGHT = 180;
const MARGIN = { top: 8, right: 4, bottom: 24, left: 36 };

/** A column's segment: square at the bottom, its top corners rounded when it's the top one. */
function segment(x: number, y: number, w: number, h: number, rounded: boolean): string {
  const r = rounded ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Checks a minute over the last hour: the ones that read the page, with those
 * that didn't stacked above them in red. Hover a minute for its numbers; the
 * table holds them all.
 */
export function Throughput({
  rows,
  at,
  time,
}: {
  rows: SystemView['throughput'];
  at: string;
  time: (t: number) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Sixty minutes ending with this one, empty minutes included.
  const last = Math.floor(Date.parse(at) / MINUTE) * MINUTE;
  const byMinute = new Map(rows.map((row) => [Date.parse(row.minute), row]));
  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const t = last - (SLOTS - 1 - i) * MINUTE;
    const row = byMinute.get(t);
    return { t, read: row?.read ?? 0, notRead: row?.notRead ?? 0 };
  });
  const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = innerWidth / SLOTS;
  const barWidth = Math.max(Math.min(24, band - 2), 1);
  const top = Math.max(...slots.map((slot) => slot.read + slot.notRead), 1);
  const y = scaleLinear().domain([0, top]).nice(3).range([innerHeight, 0]);
  const ticks = y.ticks(3);
  const shown = hover === null ? null : slots[hover]!;

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <figcaption className="text-[15px] font-semibold">Checks a minute, last hour</figcaption>
        <ul className="flex gap-4 text-[12px] text-ink-2">
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-ink" aria-hidden="true" />
            Read the page
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-danger" aria-hidden="true" />
            Didn’t
          </li>
        </ul>
      </div>
      <div ref={box} className="relative" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Checks a minute over the last hour"
          >
            <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
              {ticks.map((tick) => (
                <g key={tick} transform={`translate(0 ${y(tick)})`}>
                  <line x2={innerWidth} stroke="var(--line)" />
                  <text
                    x={-8}
                    dy="0.32em"
                    textAnchor="end"
                    className="tabular fill-ink-2 text-[11px]"
                  >
                    {tick}
                  </text>
                </g>
              ))}
              {slots.map((slot, i) => {
                const x = i * band + (band - barWidth) / 2;
                const readTop = y(slot.read);
                const readHeight = innerHeight - readTop;
                // The second segment sits 2px above the first: the surface gap between them.
                const gap = slot.read > 0 && slot.notRead > 0 ? 2 : 0;
                const failTop = y(slot.read + slot.notRead) - gap;
                const failHeight = readTop - gap - failTop;
                return (
                  <g key={slot.t} opacity={hover === null || hover === i ? 1 : 0.45}>
                    {slot.read > 0 && (
                      <path
                        d={segment(x, readTop, barWidth, readHeight, slot.notRead === 0)}
                        fill="var(--ink)"
                      />
                    )}
                    {slot.notRead > 0 && (
                      <path
                        d={segment(x, failTop, barWidth, failHeight, true)}
                        fill="var(--danger)"
                      />
                    )}
                  </g>
                );
              })}
              {slots.map((slot, i) =>
                i % 15 === 14 || i === 0 ? (
                  <text
                    key={slot.t}
                    x={i === SLOTS - 1 ? innerWidth : i * band + band / 2}
                    y={innerHeight + 17}
                    // The ends line up with the chart's edges rather than run past them.
                    textAnchor={i === 0 ? 'start' : i === SLOTS - 1 ? 'end' : 'middle'}
                    className="tabular fill-ink-2 text-[11px]"
                  >
                    {time(slot.t)}
                  </text>
                ) : null,
              )}
              {/* Hover targets: a whole minute's column, wider than its bar. */}
              {slots.map((slot, i) => (
                <rect
                  key={`hit-${slot.t}`}
                  x={i * band}
                  width={band}
                  height={innerHeight}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                />
              ))}
            </g>
          </svg>
        )}
        {shown && hover !== null && (
          <div
            className={`pointer-events-none absolute top-0 z-10 rounded-[8px] border border-line bg-paper px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-sm ${
              // Centred on its minute, but never past the chart's edges.
              hover > SLOTS - 8 ? '-translate-x-full' : hover < 8 ? '' : '-translate-x-1/2'
            }`}
            style={{ left: MARGIN.left + hover * band + band / 2 }}
          >
            <div className="tabular font-medium">{time(shown.t)}</div>
            <div>{shown.read} read the page</div>
            <div>{shown.notRead} didn’t</div>
          </div>
        )}
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-ink-2">Show as a table</summary>
        <table className="tabular mt-2 w-full max-w-md text-[12px]">
          <thead>
            <tr className="text-left text-ink-2">
              <th className="py-1 font-normal">Minute</th>
              <th className="py-1 text-right font-normal">Read the page</th>
              <th className="py-1 text-right font-normal">Didn’t</th>
            </tr>
          </thead>
          <tbody>
            {slots
              .filter((slot) => slot.read + slot.notRead > 0)
              .map((slot) => (
                <tr key={slot.t} className="border-t border-line">
                  <td className="py-1">{time(slot.t)}</td>
                  <td className="py-1 text-right">{slot.read}</td>
                  <td className="py-1 text-right">{slot.notRead}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
