import { useState } from 'react';
import { formatMoney } from '../lib/money.ts';
import { useReducedMotion } from '../lib/motion.ts';

type Direction = 'up' | 'down';

// Each wheel is the digits 0–9 three times over. It rests in the middle copy,
// so it can always roll the right way: down for a drop, even from 0 to 9.
const STRIP = Array.from({ length: 30 }, (_, i) => i % 10);
const MIDDLE = 10;
const ROW = 1.15; // em

export function nextIndex(index: number, from: number, to: number, direction: Direction): number {
  const steps = direction === 'down' ? (from - to + 10) % 10 : (to - from + 10) % 10;
  const base = index - steps < 0 || index + steps > STRIP.length - 1 ? MIDDLE + from : index;
  return direction === 'down' ? base - steps : base + steps;
}

function Wheel({
  digit,
  direction,
  reduced,
}: {
  digit: number;
  direction: Direction;
  reduced: boolean;
}) {
  const [shown, setShown] = useState(digit);
  const [index, setIndex] = useState(MIDDLE + digit);
  const [rolling, setRolling] = useState(false);

  if (shown !== digit) {
    setShown(digit);
    if (reduced) {
      setIndex(MIDDLE + digit);
    } else {
      setIndex(nextIndex(index, shown, digit, direction));
      setRolling(true);
    }
  }

  return (
    <span className="relative inline-block overflow-hidden" style={{ height: `${ROW}em` }}>
      <span
        className="flex flex-col"
        style={{
          transform: `translateY(${-index * ROW}em)`,
          transition: rolling ? 'transform 720ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
        }}
        onTransitionEnd={() => {
          // Back to the middle copy, invisibly, ready for the next roll.
          setRolling(false);
          setIndex(MIDDLE + digit);
        }}
      >
        {STRIP.map((d, i) => (
          <span key={i} className="block" style={{ height: `${ROW}em`, lineHeight: `${ROW}em` }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

interface PriceDigitsProps {
  /** Whole minor units: pence, cents, paise. */
  value: number;
  currency?: string;
  className?: string;
}

/** A price that rolls like an odometer: downwards when it drops, upwards when it rises. */
export function PriceDigits({ value, currency = 'GBP', className = '' }: PriceDigitsProps) {
  const reduced = useReducedMotion();
  const [previous, setPrevious] = useState(value);
  const [direction, setDirection] = useState<Direction>('down');

  if (previous !== value) {
    setDirection(value < previous ? 'down' : 'up');
    setPrevious(value);
  }

  const text = formatMoney(value, currency);
  const chars = [...text];

  return (
    <span className={`tabular inline-flex items-end ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex" style={{ lineHeight: `${ROW}em` }}>
        {chars.map((char, i) => {
          // Keyed from the right, so pence stay pence when the pounds grow a digit.
          const key = chars.length - i;
          return /\d/.test(char) ? (
            <Wheel key={key} digit={Number(char)} direction={direction} reduced={reduced} />
          ) : (
            <span key={key} className="inline-block" style={{ height: `${ROW}em` }}>
              {char}
            </span>
          );
        })}
      </span>
    </span>
  );
}
