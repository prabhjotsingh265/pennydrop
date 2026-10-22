import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { judge, REARM_MARGIN, type RuleState, type Situation } from './rules.ts';

const at = (price: number | null, extra: Partial<Situation> = {}): Situation => ({
  now: { price, inStock: price !== null },
  before: { price: 4000, inStock: true },
  lowestBefore: 3800,
  target: 3500,
  cheapestRival: null,
  ...extra,
});
const rule = (kind: RuleState['kind'], extra: Partial<RuleState> = {}): RuleState => ({
  kind,
  threshold: null,
  armed: true,
  ...extra,
});

describe('below target', () => {
  it('fires once on reaching the target, then waits for a climb past the margin', () => {
    expect(judge(rule('below_target'), at(3500))).toEqual({ fires: true, armed: false });
    // Still at or under: no second alert.
    expect(judge(rule('below_target', { armed: false }), at(3400))).toEqual({
      fires: false,
      armed: false,
    });
    // Just above the target, inside the margin: still not ready.
    expect(judge(rule('below_target', { armed: false }), at(3560))).toEqual({
      fires: false,
      armed: false,
    });
    // Past the margin (3500 × 1.02 = 3570): ready again.
    expect(judge(rule('below_target', { armed: false }), at(3571))).toEqual({
      fires: false,
      armed: true,
    });
  });

  it('says nothing without a price or a target', () => {
    expect(judge(rule('below_target'), at(null)).fires).toBe(false);
    expect(judge(rule('below_target'), at(3000, { target: null })).fires).toBe(false);
  });

  it('never alerts twice without a climb past the margin, however the price wobbles', () => {
    const target = 3500;
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 3300, max: 3700 }), { minLength: 1, maxLength: 60 }),
        (prices) => {
          let armed = true;
          let rearmedSinceLast = true;
          for (const price of prices) {
            const verdict = judge(
              { kind: 'below_target', threshold: null, armed },
              at(price, { target }),
            );
            if (verdict.fires) {
              expect(rearmedSinceLast).toBe(true);
              rearmedSinceLast = false;
            }
            if (price > target * (1 + REARM_MARGIN)) rearmedSinceLast = true;
            armed = verdict.armed;
          }
        },
      ),
    );
  });
});

describe('the change rules', () => {
  it('"drops by X%" compares with the price before', () => {
    expect(judge(rule('drop_percent', { threshold: 10 }), at(3600)).fires).toBe(true); // exactly 10% off 4000
    expect(judge(rule('drop_percent', { threshold: 10 }), at(3601)).fires).toBe(false);
    expect(judge(rule('drop_percent', { threshold: 10 }), at(3000, { before: null })).fires).toBe(
      false,
    );
  });

  it('"any drop" is any fall at all, and only a fall', () => {
    expect(judge(rule('any_drop'), at(3999)).fires).toBe(true);
    expect(judge(rule('any_drop'), at(4000)).fires).toBe(false);
    expect(judge(rule('any_drop'), at(4100)).fires).toBe(false);
  });

  it('"back in stock" needs it to have been out', () => {
    const back = at(4000, { before: { price: 4000, inStock: false } });
    expect(judge(rule('back_in_stock'), back).fires).toBe(true);
    expect(judge(rule('back_in_stock'), at(4000)).fires).toBe(false);
  });

  it('"lowest ever" beats every price seen before', () => {
    expect(judge(rule('lowest_ever'), at(3799)).fires).toBe(true);
    expect(judge(rule('lowest_ever'), at(3800)).fires).toBe(false);
    expect(judge(rule('lowest_ever'), at(100, { lowestBefore: null })).fires).toBe(false);
  });
});

describe('undercut', () => {
  it('fires when a rival gets cheaper than your listing, once, until it isn’t', () => {
    const under = at(5000, { cheapestRival: 4900 });
    expect(judge(rule('undercut'), under)).toEqual({ fires: true, armed: false });
    expect(judge(rule('undercut', { armed: false }), under)).toEqual({
      fires: false,
      armed: false,
    });
    expect(judge(rule('undercut', { armed: false }), at(5000, { cheapestRival: 5000 }))).toEqual({
      fires: false,
      armed: true,
    });
  });
});
