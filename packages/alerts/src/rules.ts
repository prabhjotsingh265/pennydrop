import type { RuleKind } from '@pennydrop/domain';

/** "Below target" re-arms only once the price is back this far above it: a wobble alerts once. */
export const REARM_MARGIN = 0.02;

export interface Reading {
  /** Minor units; null when no price showed (out of stock with none given). */
  price: number | null;
  inStock: boolean;
}

/** Everything a rule may look at, for one product at one new price point. */
export interface Situation {
  now: Reading;
  /** The price point before this one, if any. */
  before: Reading | null;
  /** The lowest price ever seen before this point. */
  lowestBefore: number | null;
  target: number | null;
  /** For "undercut": the cheapest other shop in the product's group, in the same currency. */
  cheapestRival: number | null;
}

export interface RuleState {
  kind: RuleKind;
  threshold: number | null;
  armed: boolean;
}

export interface Verdict {
  fires: boolean;
  /** Whether the rule is ready to fire next time. */
  armed: boolean;
}

/**
 * Whether a rule fires at a new price point, and its state afterwards.
 * "Below target" and "undercut" disarm when they fire and re-arm only when
 * the reason has gone away; the others describe one change and fire each time.
 */
export function judge(rule: RuleState, s: Situation): Verdict {
  const price = s.now.price;
  const before = s.before?.price ?? null;
  const steady = (fires: boolean): Verdict => ({ fires, armed: rule.armed });

  switch (rule.kind) {
    case 'below_target': {
      if (price === null || s.target === null) return steady(false);
      if (price <= s.target) return { fires: rule.armed, armed: false };
      // Back above, by the margin: ready again. In between, it stays as it was.
      return price > s.target * (1 + REARM_MARGIN) ? { fires: false, armed: true } : steady(false);
    }
    case 'drop_percent': {
      const threshold = rule.threshold ?? 0;
      return steady(
        price !== null &&
          before !== null &&
          threshold > 0 &&
          price <= before * (1 - threshold / 100),
      );
    }
    case 'any_drop':
      return steady(price !== null && before !== null && price < before);
    case 'back_in_stock':
      return steady(s.before !== null && !s.before.inStock && s.now.inStock);
    case 'lowest_ever':
      return steady(price !== null && s.lowestBefore !== null && price < s.lowestBefore);
    case 'undercut': {
      if (price === null || s.cheapestRival === null) return steady(false);
      if (s.cheapestRival < price) return { fires: rule.armed, armed: false };
      return { fires: false, armed: true };
    }
  }
}
