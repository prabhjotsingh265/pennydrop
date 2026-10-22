import type { BreakAction, DemoState, SandboxState } from '@pennydrop/domain';
import { useQueryClient } from '@tanstack/react-query';
import { BadgePercent, LayoutTemplate, PackageX, ServerCrash, Snail, Wrench } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { BREAKS } from '../../lib/demo.ts';
import { keys } from '../../lib/queries.ts';
import { Button } from '../../ui/Button.tsx';
import { Notice } from '../../ui/Notice.tsx';

const ICONS = {
  redesign: LayoutTemplate,
  sale: BadgePercent,
  sell_out: PackageX,
  slow: Snail,
  fail: ServerCrash,
};

/**
 * The demo's controls for the visitor's own copy of the shop. Each button
 * changes it and has it checked straight away; the page then shows what
 * Pennydrop made of it.
 */
export function BreakShop({ state, onBroken }: { state: SandboxState; onBroken: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<BreakAction | null>(null);
  const [last, setLast] = useState<BreakAction | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const press = async (action: BreakAction) => {
    setBusy(action);
    setProblem(null);
    try {
      const answer = await api<{ state: SandboxState }>('/api/demo/break', {
        method: 'POST',
        body: { action },
      });
      queryClient.setQueryData<DemoState>(
        keys.demo,
        (old) => old && { ...old, sandbox: old.sandbox && { ...old.sandbox, state: answer.state } },
      );
      setLast(action);
      onBroken();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The shop didn’t change.');
    } finally {
      setBusy(null);
    }
  };

  const told =
    last === null
      ? 'Press one, and your shop is checked straight away.'
      : last === 'fix'
        ? 'Back to normal: the next check shows it.'
        : BREAKS.find((b) => b.action === last)!.expect;

  return (
    <section
      aria-labelledby="break"
      className="rounded-[14px] border border-dashed border-copper/60 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="break" className="text-[15px] font-semibold">
          Break the shop
        </h2>
        <p className="text-[12px] text-ink-2">
          This page is on your own copy of the practice shop: nobody else sees what you do to it.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {BREAKS.map(({ action, label, on }) => {
          const Icon = ICONS[action];
          const pressed = state[on];
          return (
            <button
              key={action}
              type="button"
              aria-pressed={pressed}
              disabled={busy !== null}
              onClick={() => void press(action)}
              className={`inline-flex h-10 items-center gap-2 rounded-[8px] border px-3.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                pressed
                  ? 'border-copper bg-copper text-on-copper'
                  : 'border-line bg-surface hover:border-ink-2/40'
              }`}
            >
              {busy === action ? (
                <span
                  aria-hidden="true"
                  className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
                />
              ) : (
                <Icon size={16} aria-hidden="true" />
              )}
              {label}
            </button>
          );
        })}
        <Button busy={busy === 'fix'} disabled={busy !== null} onClick={() => void press('fix')}>
          {busy !== 'fix' && <Wrench size={16} aria-hidden="true" />}
          Fix everything
        </Button>
      </div>
      <p role="status" className="mt-4 max-w-[64ch] text-sm leading-6">
        {told}
      </p>
      {problem && (
        <div className="mt-3">
          <Notice tone="error">{problem}</Notice>
        </div>
      )}
    </section>
  );
}
