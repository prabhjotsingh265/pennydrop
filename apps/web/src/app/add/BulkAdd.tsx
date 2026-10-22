import {
  BULK_MAX,
  DEFAULT_INTERVAL,
  INTERVALS,
  type BulkResult,
  type WatchSummary,
} from '@pennydrop/domain';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api.ts';
import { parseBulk } from '../../lib/bulk.ts';
import { formatMoney } from '../../lib/money.ts';
import { keys, useWatches } from '../../lib/queries.ts';
import { every } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { Notice } from '../../ui/Notice.tsx';

type LineState =
  | { kind: 'read'; text: string }
  | { kind: 'reading' }
  | { kind: 'pick'; href: string }
  | { kind: 'refused'; text: string };

/** Where one added line has got to, from the watchlist as it updates live. */
function stateOf(result: BulkResult, watches: Map<string, WatchSummary>): LineState {
  if (!result.ok) return { kind: 'refused', text: result.error };
  const watch = watches.get(result.watchId);
  if (!watch || (watch.price === null && !watch.lastCheckedAt)) return { kind: 'reading' };
  if (watch.price === null || watch.status === 'needs_attention') {
    return { kind: 'pick', href: `/app/p/${watch.id}?pick=1` };
  }
  const price = formatMoney(watch.price, watch.currency ?? 'GBP');
  return { kind: 'read', text: result.created ? price : `${price}, already on your watchlist` };
}

function Results({ results }: { results: BulkResult[] }) {
  const watches = useWatches();
  const byId = new Map((watches.data ?? []).map((watch) => [watch.id, watch]));
  const states = results.map((result) => stateOf(result, byId));
  const count = (kind: LineState['kind']) => states.filter((s) => s.kind === kind).length;

  return (
    <section aria-labelledby="bulk-results" aria-live="polite" className="max-w-3xl">
      <h2 id="bulk-results" className="text-[15px] font-semibold">
        {count('reading') ? 'Reading their prices…' : 'Done'}
      </h2>
      <p className="tabular mt-1 text-[12px] text-ink-2">
        {count('read')} read · {count('reading')} still reading · {count('pick')} need your pick ·{' '}
        {count('refused')} not added
      </p>
      <ul className="mt-4 divide-y divide-line">
        {results.map((result, index) => {
          const state = states[index]!;
          return (
            <li
              key={index}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
            >
              <span className="tabular min-w-0 truncate text-[12px] text-ink-2">{result.url}</span>
              <span className="text-sm">
                {state.kind === 'read' && (
                  <span className="inline-flex items-center gap-1.5">
                    <Check size={14} className="text-verdigris-deep" aria-hidden="true" />
                    <span className="tabular">{state.text}</span>
                  </span>
                )}
                {state.kind === 'reading' && <span className="text-ink-2">Reading…</span>}
                {state.kind === 'pick' && (
                  <Link to={state.href} className="font-medium text-copper-deep underline">
                    Needs your pick
                  </Link>
                )}
                {state.kind === 'refused' && <span className="text-danger">{state.text}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Several products at once: pasted addresses, or a CSV of address, target and label. */
export function BulkAdd() {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [fromFile, setFromFile] = useState(false);
  const [seconds, setSeconds] = useState(String(DEFAULT_INTERVAL));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const parsed = parseBulk(text, fromFile);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    setFromFile(true);
  };

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await api<{ results: BulkResult[] }>('/api/watches/bulk', {
        method: 'POST',
        body: {
          items: parsed.items.map(({ url, targetPrice, label }) => ({ url, targetPrice, label })),
          intervalSeconds: Number(seconds),
        },
      });
      setResults(answer.results);
      await queryClient.invalidateQueries({ queryKey: keys.watches });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (results) {
    return (
      <div className="space-y-6">
        <Results results={results} />
        <Button
          onClick={() => {
            setResults(null);
            setText('');
            setFromFile(false);
          }}
        >
          Add more
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      {problem && <Notice tone="error">{problem}</Notice>}
      <div>
        <label htmlFor="bulk" className="mb-1.5 block text-sm font-medium">
          Product page addresses
        </label>
        <textarea
          id="bulk"
          rows={9}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFromFile(false);
          }}
          placeholder={
            'https://shop.example.com/products/kettle\nhttps://another.example.com/p/lamp'
          }
          className="tabular w-full rounded-[8px] border border-line bg-paper px-3 py-2.5 text-[13px] leading-6 outline-none placeholder:text-ink-2/60 focus:border-copper-deep"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-2">
          <span>
            One per line, up to {BULK_MAX}. A CSV can have the columns address, target and label.
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-copper-deep underline">
            <Upload size={14} aria-hidden="true" />
            Upload a CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={upload} />
          </label>
        </div>
      </div>

      {text.trim() && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p>
            {parsed.items.length} {parsed.items.length === 1 ? 'address' : 'addresses'} ready
            {parsed.items.some((item) => item.targetPrice) && ', some with targets'}.
          </p>
          {parsed.tooMany && (
            <Notice tone="error">
              That’s {parsed.items.length}. Up to {BULK_MAX} can be added at once.
            </Notice>
          )}
          {parsed.problems.length > 0 && (
            <ul className="space-y-1 text-[13px] text-danger">
              {parsed.problems.map((p) => (
                <li key={p.line}>
                  Line {p.line}: {p.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <label htmlFor="bulk-interval" className="mb-1.5 block text-sm font-medium">
          Check them
        </label>
        <select
          id="bulk-interval"
          value={seconds}
          onChange={(event) => setSeconds(event.target.value)}
          className="h-11 w-full rounded-[8px] border border-line bg-paper px-3 text-[15px]"
        >
          {INTERVALS.map((option) => (
            <option key={option} value={option}>
              {every(option)}
              {option < 3_600 ? ' (practice shops only)' : ''}
            </option>
          ))}
        </select>
      </div>

      <Button
        variant="primary"
        busy={busy}
        disabled={!parsed.items.length || parsed.tooMany}
        onClick={() => void submit()}
      >
        Add {parsed.items.length || ''} {parsed.items.length === 1 ? 'product' : 'products'}
      </Button>
    </div>
  );
}
