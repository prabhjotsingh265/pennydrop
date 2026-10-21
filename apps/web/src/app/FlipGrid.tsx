import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/motion.ts';

gsap.registerPlugin(Flip);

/**
 * A grid whose cards glide to their new places when the order changes: a
 * product whose price just dropped rises past the others rather than
 * jumping. Positions are remembered after each move, so the next one starts
 * from where the cards really are.
 */
export function FlipGrid({ order, children }: { order: string; children: ReactNode }) {
  const grid = useRef<HTMLDivElement>(null);
  const before = useRef<Flip.FlipState | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const cards = grid.current?.querySelectorAll('[data-card]');
    if (!cards) return;
    const remember = () => {
      before.current = Flip.getState(cards);
    };
    if (before.current && !reduced) {
      const tween = Flip.from(before.current, {
        targets: cards,
        duration: 0.7,
        ease: 'power3.inOut',
        onComplete: remember,
      });
      return () => {
        tween.kill();
      };
    }
    remember();
  }, [order, reduced]);

  // A new width can mean new columns: start the next move from there.
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      before.current = Flip.getState(element.querySelectorAll('[data-card]'));
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
