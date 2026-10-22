import type { BreakAction, SandboxState } from '@pennydrop/domain';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "ends in 23 h", "ends in 40 min", "has ended". */
export function endsWords(expiresAt: string, now: number): string {
  const left = Date.parse(expiresAt) - now;
  if (left <= 0) return 'has ended';
  if (left < HOUR) return `ends in ${Math.max(1, Math.round(left / MINUTE))} min`;
  return `ends in ${Math.round(left / HOUR)} h`;
}

/** The "Break the shop" buttons: what each is called, what it shows when on, and what to watch for. */
export const BREAKS: {
  action: Exclude<BreakAction, 'fix'>;
  label: string;
  on: keyof SandboxState;
  expect: string;
}[] = [
  {
    action: 'redesign',
    label: 'Redesign the page',
    on: 'redesigned',
    expect:
      'The price moves and its markup is renamed. Watch the timeline: the old way of reading it breaks, and Pennydrop finds the price another way.',
  },
  {
    action: 'sale',
    label: 'Start a sale',
    on: 'onSale',
    expect:
      'The price drops through your target. An alert lands in your inbox, and the bell gets a penny.',
  },
  {
    action: 'sell_out',
    label: 'Sell out',
    on: 'soldOut',
    expect: 'The page says sold out. The chart hatches the stretch it lasts.',
  },
  {
    action: 'slow',
    label: 'Slow it down',
    on: 'slow',
    expect:
      'Each page takes 6–9 seconds. Open the check log’s waterfall to see where the time goes.',
  },
  {
    action: 'fail',
    label: 'Make it fail',
    on: 'failing',
    expect:
      'Every page answers 500. Checks retry, then the circuit breaker opens, and the shop is left alone for a while. Other shops carry on.',
  },
];
