import { describe, expect, it } from 'vitest';
import { demoTarget, practiceUrl } from './demo.ts';
import {
  addWatchSchema,
  minorUnitsFrom,
  updateWatchSchema,
  updateWorkspaceSchema,
} from './index.ts';

describe('minorUnitsFrom', () => {
  it.each([
    ['35', 'GBP', 3500],
    ['£35.00', 'GBP', 3500],
    ['34.5', 'GBP', 3450],
    ['1,299.99', 'USD', 129999],
    ['1.299,99', 'EUR', 129999],
    ['1299', 'JPY', 1299],
  ])('reads %s %s', (text, currency, minor) => {
    expect(minorUnitsFrom(text, currency)).toBe(minor);
  });

  it('refuses nothing and zero', () => {
    expect(minorUnitsFrom('', 'GBP')).toBeNull();
    expect(minorUnitsFrom('0', 'GBP')).toBeNull();
    expect(minorUnitsFrom('free', 'GBP')).toBeNull();
  });
});

describe('the watch schemas', () => {
  it('fills in the default interval and refuses ones that aren’t offered', () => {
    expect(addWatchSchema.parse({ url: 'fickle.example.com/p/mug' }).intervalSeconds).toBe(21_600);
    expect(addWatchSchema.safeParse({ url: 'x', intervalSeconds: 5 }).success).toBe(false);
  });

  it('refuses fields it doesn’t know, and prices that aren’t positive whole minor units', () => {
    expect(addWatchSchema.safeParse({ url: 'x', admin: true }).success).toBe(false);
    expect(updateWatchSchema.safeParse({ targetPrice: 0 }).success).toBe(false);
    expect(updateWatchSchema.safeParse({ targetPrice: 12.5 }).success).toBe(false);
    expect(updateWatchSchema.parse({ targetPrice: null })).toEqual({ targetPrice: null });
  });
});

describe('the workspace schema', () => {
  it('takes real time zones only', () => {
    expect(updateWorkspaceSchema.parse({ timezone: 'Asia/Kolkata' })).toEqual({
      timezone: 'Asia/Kolkata',
    });
    expect(updateWorkspaceSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('sets and clears quiet hours as a pair', () => {
    const ok = (body: object) => updateWorkspaceSchema.safeParse(body).success;
    expect(ok({ quietFrom: 22 * 60, quietUntil: 7 * 60 })).toBe(true);
    expect(ok({ quietFrom: null, quietUntil: null })).toBe(true);
    expect(ok({ digest: true, digestAt: 8 * 60 })).toBe(true);
    expect(ok({ quietFrom: 22 * 60 })).toBe(false);
    expect(ok({ quietFrom: 22 * 60, quietUntil: null })).toBe(false);
    expect(ok({ quietFrom: 600, quietUntil: 600 })).toBe(false);
    expect(ok({ quietFrom: 1_440, quietUntil: 0 })).toBe(false);
  });
});

describe('the demo', () => {
  it('builds practice-shop addresses, sandboxes included', () => {
    expect(practiceUrl('http://{shop}.localhost:4000', 'fickle', '/p/mug')).toBe(
      'http://fickle.localhost:4000/p/mug',
    );
    expect(practiceUrl('https://{shop}.example.com', 'sandbox-ab12cd34', '/p/mug')).toBe(
      'https://sandbox-ab12cd34.example.com/p/mug',
    );
  });

  it('starts with a target a little under today’s price', () => {
    expect(demoTarget(2399)).toBe(2150);
    expect(demoTarget(40)).toBe(50);
  });
});
