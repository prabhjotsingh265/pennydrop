import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/motion.ts';

/** Slow at both ends (GSAP's power3.inOut), as the landing page's moves are. */
const EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';

/** Where each card is on the page now. */
function places(grid: HTMLElement): Map<Element, DOMRect> {
  return new Map(
    [...grid.querySelectorAll('[data-card]')].map((card) => [card, card.getBoundingClientRect()]),
  );
}

/**
 * A grid whose cards glide to their new places when the order changes: a
 * product whose price just dropped rises past the others rather than
 * jumping. Each card is drawn where it was and slides to where it now is
 * (the FLIP technique), with the browser's own animations.
 */
export function FlipGrid({ order, children }: { order: string; children: ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  const before = useRef<Map<Element, DOMRect> | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    const was = before.current;
    const now = places(element);
    before.current = now;
    if (!was || reduced) return;
    const moves = [...now].flatMap(([card, rect]) => {
      const from = was.get(card);
      const dx = from ? from.left - rect.left : 0;
      const dy = from ? from.top - rect.top : 0;
      if (!dx && !dy) return [];
      return [
        card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: 700,
          easing: EASE,
        }),
      ];
    });
    return () => {
      for (const move of moves) move.cancel();
    };
  }, [order, reduced]);

  // A new width can mean new columns: start the next move from there.
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      before.current = places(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={grid} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}
