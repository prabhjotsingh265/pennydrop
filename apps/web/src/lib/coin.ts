import { useEffect, useRef, type RefObject } from 'react';

const GRAVITY = 2600; // px/s², tuned by eye for a coin a few centimetres across
const BOUNCE = 0.32; // share of speed kept after hitting the new price
const REST_SPEED = 45; // px/s; slower than this after a bounce and it settles
const SPRING = 160; // stiffness for rising, critically damped

export interface CoinState {
  y: number;
  v: number;
}

/**
 * Moves a coin to a new height. Drops fall under gravity and bounce once or
 * twice; rises spring back up. SVG y grows downwards, so a lower price is a
 * bigger y. Calls `onFrame` with each new y; React doesn't re-render per frame.
 */
export function useCoinPhysics(
  targetY: number,
  onFrame: (y: number) => void,
  reduced: boolean,
): RefObject<CoinState> {
  const state = useRef<CoinState>({ y: targetY, v: 0 });
  const frame = useRef(onFrame);

  useEffect(() => {
    frame.current = onFrame;
  });

  useEffect(() => {
    const s = state.current;
    if (reduced || Math.abs(targetY - s.y) < 0.01) {
      s.y = targetY;
      s.v = 0;
      frame.current(s.y);
      return;
    }

    const falling = targetY > s.y;
    let last = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;

      if (falling) {
        s.v += GRAVITY * dt;
        s.y += s.v * dt;
        if (s.y >= targetY) {
          s.y = targetY;
          s.v = -s.v * BOUNCE;
          if (Math.abs(s.v) < REST_SPEED) {
            s.v = 0;
            frame.current(s.y);
            return;
          }
        }
      } else {
        const accel = -SPRING * (s.y - targetY) - 2 * Math.sqrt(SPRING) * s.v;
        s.v += accel * dt;
        s.y += s.v * dt;
        if (Math.abs(s.y - targetY) < 0.05 && Math.abs(s.v) < 1) {
          s.y = targetY;
          s.v = 0;
          frame.current(s.y);
          return;
        }
      }

      frame.current(s.y);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targetY, reduced]);

  return state;
}
