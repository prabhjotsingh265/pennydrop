import { describe, expect, it } from 'vitest';
import { minutesToTime, ruleWaiting, timeToMinutes } from './alerts.ts';

describe('time fields', () => {
  it('goes between minutes after midnight and "HH:MM"', () => {
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(22 * 60 + 5)).toBe('22:05');
    expect(timeToMinutes('07:30')).toBe(450);
    expect(timeToMinutes('23:59')).toBe(1_439);
    expect(timeToMinutes('24:00')).toBeNull();
    expect(timeToMinutes('7:30')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
  });
});

describe('ruleWaiting', () => {
  it('says what a rule that has fired is waiting for', () => {
    expect(ruleWaiting({ kind: 'below_target', armed: false }, 1900, 'GBP')).toBe(
      'Alerts again once the price has been above £19.38',
    );
    expect(ruleWaiting({ kind: 'undercut', armed: false }, null, 'GBP')).toBe(
      'Alerts again once no shop is cheaper than you',
    );
    expect(ruleWaiting({ kind: 'below_target', armed: true }, 1900, 'GBP')).toBeNull();
    // The others describe one change, so they're never waiting.
    expect(ruleWaiting({ kind: 'any_drop', armed: false }, null, 'GBP')).toBeNull();
  });
});
