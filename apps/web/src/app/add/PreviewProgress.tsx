import type { PreviewView } from '@pennydrop/domain';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useNow } from '../../lib/time.ts';

interface Stage {
  label: string;
  state: 'done' | 'now' | 'later';
}

function stages(view: PreviewView | undefined): Stage[] {
  const step = view?.step;
  const working = view?.status === 'working';
  const waited = step === 'waiting' || working;
  return [
    { label: 'In the queue', state: view && (step || working) ? 'done' : 'now' },
    ...(step === 'waiting' && !working
      ? [{ label: 'Waiting for the shop’s turn', state: 'now' as const }]
      : []),
    {
      label: 'Reading robots.txt, then opening the page in a browser',
      state: working ? 'now' : waited ? 'done' : 'later',
    },
    { label: 'Boxing every price on the page', state: 'later' },
  ];
}

/** While the browser fetcher works: where it's got to, over a page being scanned. */
export function PreviewProgress({ view, host }: { view: PreviewView | undefined; host: string }) {
  // Shown the moment the preview is asked for, so this is when it started.
  const [startedAt] = useState(() => Date.now());
  const now = useNow(250);
  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" aria-live="polite">
      <div>
        <p className="text-[15px]">
          Opening <strong>{host}</strong> the way a browser would.
        </p>
        <ol className="mt-5 space-y-3">
          {stages(view).map((stage) => (
            <li key={stage.label} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${
                  stage.state === 'done'
                    ? 'border-copper bg-copper text-on-copper'
                    : stage.state === 'now'
                      ? 'border-copper-deep'
                      : 'border-line'
                }`}
              >
                {stage.state === 'done' && <Check size={12} strokeWidth={3} />}
                {stage.state === 'now' && (
                  <span className="size-2 animate-pulse rounded-full bg-copper-deep" />
                )}
              </span>
              <span className={stage.state === 'later' ? 'text-ink-2' : ''}>{stage.label}</span>
            </li>
          ))}
        </ol>
        <p className="tabular mt-6 text-[12px] text-ink-2">
          {((now - startedAt) / 1000).toFixed(1)} s
        </p>
      </div>
      <div
        aria-hidden="true"
        className="relative aspect-[1280/800] overflow-hidden rounded-[14px] border border-line bg-surface"
      >
        <div className="absolute inset-x-[6%] top-[9%] h-[5%] rounded bg-line/60" />
        <div className="absolute top-[22%] left-[6%] h-[42%] w-[46%] rounded bg-line/40" />
        <div className="absolute top-[24%] right-[6%] h-[6%] w-[30%] rounded bg-line/60" />
        <div className="absolute top-[34%] right-[6%] h-[9%] w-[18%] rounded bg-line/60" />
        <div className="absolute top-[72%] left-[6%] h-[4%] w-[60%] rounded bg-line/40" />
        <div className="scan absolute inset-x-0 h-12" />
      </div>
    </div>
  );
}
