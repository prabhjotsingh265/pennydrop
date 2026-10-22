import {
  RULE_KINDS,
  ruleWords,
  type RuleKind,
  type RuleSummary,
  type WatchSummary,
} from '@pennydrop/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { ruleWaiting } from '../../lib/alerts.ts';
import { api } from '../../lib/api.ts';
import { keys, useChannels, useRules } from '../../lib/queries.ts';
import { ago, useNow } from '../../lib/time.ts';
import { Notice } from '../../ui/Notice.tsx';
import { Switch } from '../../ui/Switch.tsx';

const DEFAULT_DROP = 10;

/** A whole number of per cent the rule takes, or null. */
const percent = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : null;
};

/** "Drops by [10]% or more at once": a rule that's on saves a new number when you leave the box. */
function DropPercent({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      Drops by
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={90}
        value={value}
        aria-label="Per cent"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => event.key === 'Enter' && onCommit()}
        className="tabular h-8 w-16 rounded-[8px] border border-line bg-paper px-2 text-sm outline-none focus:border-copper-deep"
      />
      % or more at once
    </span>
  );
}

/** The six rules, each with its switch. Mounted once the rules are known. */
function RuleList({
  watch,
  rules,
  onProblem,
}: {
  watch: WatchSummary;
  rules: RuleSummary[];
  onProblem: (problem: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const now = useNow();
  const [busy, setBusy] = useState<RuleKind | null>(null);
  const byKind = new Map(rules.map((rule) => [rule.kind, rule]));
  const [drop, setDrop] = useState(String(byKind.get('drop_percent')?.threshold ?? DEFAULT_DROP));
  const currency = watch.currency ?? 'GBP';

  const change = async (kind: RuleKind, on: boolean) => {
    const threshold = percent(drop);
    if (on && kind === 'drop_percent' && threshold === null) {
      onProblem('Say a whole number of per cent, from 1 to 90.');
      return;
    }
    setBusy(kind);
    onProblem(null);
    try {
      await (on
        ? api(`/api/watches/${watch.id}/rules/${kind}`, {
            method: 'PUT',
            body: kind === 'drop_percent' ? { threshold } : {},
          })
        : api(`/api/watches/${watch.id}/rules/${kind}`, { method: 'DELETE' }));
      await queryClient.invalidateQueries({ queryKey: keys.rules(watch.id) });
    } catch (error) {
      onProblem(error instanceof Error ? error.message : 'Not changed.');
    } finally {
      setBusy(null);
    }
  };

  /** Why a rule can't be turned on yet, or what one that's on is waiting for. */
  const note = (kind: RuleKind, rule: RuleSummary | undefined): string | null => {
    if (kind === 'below_target' && watch.targetPrice === null) {
      return rule
        ? 'No target is set, so this waits for one.'
        : 'Set a target first: on the chart, or in Settings below.';
    }
    if (kind === 'undercut' && !watch.isMine) {
      return 'For your own listing: mark it as yours in a group, below.';
    }
    if (!rule) return null;
    const waiting = ruleWaiting(rule, watch.targetPrice, currency);
    if (waiting) return waiting;
    return rule.lastFiredAt
      ? `Last alerted ${ago(Math.max(now - Date.parse(rule.lastFiredAt), 0))}`
      : null;
  };

  return (
    <ul className="mt-3 divide-y divide-line border-y border-line">
      {RULE_KINDS.map((kind) => {
        const rule = byKind.get(kind);
        const blocked =
          !rule &&
          ((kind === 'below_target' && watch.targetPrice === null) ||
            (kind === 'undercut' && !watch.isMine));
        const words = note(kind, rule);
        return (
          <li key={kind} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0 text-sm">
              {kind === 'drop_percent' ? (
                <DropPercent
                  value={drop}
                  onChange={setDrop}
                  onCommit={() => {
                    if (rule && percent(drop) !== rule.threshold) void change(kind, true);
                  }}
                />
              ) : (
                ruleWords(kind)
              )}
              {words && <p className="mt-0.5 text-[12px] text-ink-2">{words}</p>}
            </div>
            <Switch
              checked={Boolean(rule)}
              label={ruleWords(kind, percent(drop) ?? DEFAULT_DROP)}
              disabled={blocked}
              busy={busy === kind}
              onChange={(on) => void change(kind, on)}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Which changes to this product send an alert, and where alerts go. */
export function AlertRules({ watch }: { watch: WatchSummary }) {
  const rules = useRules(watch.id);
  const channels = useChannels();
  const [problem, setProblem] = useState<string | null>(null);
  const sent = channels.data?.filter((channel) => channel.status === 'active').length ?? 0;

  return (
    <section aria-labelledby="alerts" className="max-w-xl">
      <h2 id="alerts" className="text-[15px] font-semibold">
        Alerts
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        {channels.isPending ? (
          'Alert me when it…'
        ) : sent === 0 ? (
          <>
            Alerts land in your inbox here. To have them sent too,{' '}
            <Link to="/app/channels" className="text-copper-deep underline">
              add a channel
            </Link>
            .
          </>
        ) : (
          <>
            Alerts go to your inbox and{' '}
            <Link to="/app/channels" className="text-copper-deep underline">
              {sent} {sent === 1 ? 'channel' : 'channels'}
            </Link>
            . Alert me when it…
          </>
        )}
      </p>
      {problem && (
        <div className="mt-4">
          <Notice tone="error">{problem}</Notice>
        </div>
      )}
      {rules.isPending ? (
        <div className="mt-4 h-[280px] animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      ) : rules.isError ? (
        <div className="mt-4">
          <Notice tone="error">{rules.error.message}</Notice>
        </div>
      ) : (
        <RuleList watch={watch} rules={rules.data} onProblem={setProblem} />
      )}
    </section>
  );
}
