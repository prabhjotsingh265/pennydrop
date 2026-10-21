import { useEffect, useState } from 'react';
import { StepChart } from '../components/StepChart.tsx';
import { useReducedMotion } from '../lib/motion.ts';

// A price drifting down, a wobble or two, then through the target.
const STEPS = [4800, 4650, 4700, 4400, 4250, 4300, 3950, 3700];
const TARGET = 3800;

/** The whole product in one loop: check by check, the price falls until the penny drops. */
export function DropLoop() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;
  const shown = reduced ? last : Math.min(step, last);

  useEffect(() => {
    if (reduced) return;
    // Linger once the coin is through, then start again.
    const id = window.setTimeout(
      () => setStep((s) => (s >= last + 2 ? 0 : s + 1)),
      step >= last ? 1_800 : 1_100,
    );
    return () => window.clearTimeout(id);
  }, [step, last, reduced]);

  return (
    <StepChart
      points={STEPS.slice(0, shown + 1).map((price, t) => ({ t, price }))}
      target={TARGET}
      domain={[0, last]}
      now={shown}
      height={240}
      yDomain={[3_300, 5_100]}
      label="A price stepping down, check by check, until it falls through its target"
    />
  );
}
