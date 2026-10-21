import { zodResolver } from '@hookform/resolvers/zod';
import {
  DEFAULT_INTERVAL,
  INTERVALS,
  minorUnitsFrom,
  previewSchema,
  type PreviewShown,
  type WatchSummary,
} from '@pennydrop/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { ApiError, api } from '../../lib/api.ts';
import { formatMoney } from '../../lib/money.ts';
import { firstChoice } from '../../lib/picker.ts';
import { keys, usePreview } from '../../lib/queries.ts';
import { every } from '../../lib/time.ts';
import { Button, buttonClass } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PreviewProgress } from './PreviewProgress.tsx';
import { ChoiceList, ScreenshotFrame } from './ScreenshotPicker.tsx';

/** Outcomes where the shop may simply be having a bad moment: saving and trying later makes sense. */
const PASSING = new Set(['timeout', 'network_error', 'http_error', 'rate_limited']);

interface Previewing {
  id: string;
  url: string;
}

function AddressForm({ onPreview }: { onPreview: (preview: Previewing) => void }) {
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<{ url: string }>({ resolver: zodResolver(previewSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ url }) => {
    setProblem(null);
    try {
      const answer = await api<{ id: string; url: string } | { watchId: string }>('/api/previews', {
        method: 'POST',
        body: { url },
      });
      // Already on the watchlist: there's nothing to add.
      if ('watchId' in answer) {
        navigate('/app', { state: { already: answer.watchId } });
        return;
      }
      onPreview(answer);
    } catch (error) {
      if (error instanceof ApiError && error.field === 'url') {
        form.setError('url', { message: error.message });
      } else {
        setProblem(error instanceof Error ? error.message : 'Something went wrong.');
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-2xl space-y-4">
      {problem && <Notice tone="error">{problem}</Notice>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          label="Product page address"
          placeholder="https://shop.example.com/products/…"
          inputMode="url"
          autoComplete="off"
          autoFocus
          className="flex-1"
          error={errors.url?.message}
          hint="Paste it from your browser’s address bar."
          {...form.register('url')}
        />
        <Button type="submit" variant="primary" busy={isSubmitting} className="sm:mt-[26px]">
          Preview
        </Button>
      </div>
    </form>
  );
}

interface SaveValues {
  label: string;
  target: string;
  interval: string;
}

function SaveForm({
  preview,
  result,
  choice,
  onRestart,
}: {
  preview: Previewing;
  result: PreviewShown;
  choice: number | null;
  onRestart: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const currency = result.currency ?? 'GBP';
  const form = useForm<SaveValues>({
    defaultValues: { label: result.title ?? '', target: '', interval: String(DEFAULT_INTERVAL) },
  });
  const { errors, isSubmitting } = form.formState;
  const needsPick = result.choices.length > 0 && choice === null;
  const amount = choice === null ? result.amount : (result.choices[choice]?.amount ?? null);

  const onSubmit = form.handleSubmit(async (values) => {
    setProblem(null);
    const target = values.target.trim() ? minorUnitsFrom(values.target, currency) : undefined;
    if (target === null) {
      form.setError('target', { message: 'That doesn’t look like a price.' });
      return;
    }
    try {
      await api<{ watch: WatchSummary }>('/api/watches', {
        method: 'POST',
        body: {
          url: preview.url,
          label: values.label.trim() || undefined,
          targetPrice: target,
          intervalSeconds: Number(values.interval),
          preview: choice === null ? undefined : { id: preview.id, choice },
        },
      });
      await queryClient.invalidateQueries({ queryKey: keys.watches });
      navigate('/app');
    } catch (error) {
      if (error instanceof ApiError && error.field === 'intervalSeconds') {
        form.setError('interval', { message: error.message });
      } else {
        setProblem(error instanceof Error ? error.message : 'Something went wrong.');
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {problem && (
        <Notice tone="error">
          {problem}{' '}
          <button type="button" onClick={onRestart} className="font-medium underline">
            Start again
          </button>
        </Notice>
      )}
      <Field label="Name" error={errors.label?.message} {...form.register('label')} />
      <Field
        label="Tell me when it drops to"
        placeholder={amount ? `e.g. ${formatMoney(Math.round(amount * 0.9), currency)}` : ''}
        inputMode="decimal"
        hint="Optional. Leave it empty to just follow the price."
        error={errors.target?.message}
        {...form.register('target')}
      />
      <div>
        <label htmlFor="interval" className="mb-1.5 block text-sm font-medium">
          Check it
        </label>
        <select
          id="interval"
          {...form.register('interval')}
          aria-invalid={errors.interval ? true : undefined}
          className="h-11 w-full rounded-[8px] border border-line bg-paper px-3 text-[15px] aria-invalid:border-danger"
        >
          {INTERVALS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {every(seconds)}
              {seconds < 3_600 ? ' (practice shops only)' : ''}
            </option>
          ))}
        </select>
        {errors.interval && (
          <p role="alert" className="mt-1.5 text-[13px] text-danger">
            {errors.interval.message}
          </p>
        )}
      </div>
      <Button
        type="submit"
        variant="primary"
        busy={isSubmitting}
        disabled={needsPick}
        className="w-full"
      >
        Add to watchlist
      </Button>
      {needsPick && (
        <p className="text-center text-[13px] text-ink-2">Pick the product’s price first.</p>
      )}
    </form>
  );
}

function Refused({
  preview,
  result,
  onRestart,
}: {
  preview: Previewing;
  result: PreviewShown;
  onRestart: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const keepTrying = async () => {
    setSaving(true);
    try {
      await api('/api/watches', { method: 'POST', body: { url: preview.url } });
      await queryClient.invalidateQueries({ queryKey: keys.watches });
      navigate('/app');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong.');
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-5">
      <Notice tone="error">{result.detail}</Notice>
      {problem && <Notice tone="error">{problem}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={onRestart}>
          Try another address
        </Button>
        {PASSING.has(result.outcome) && (
          <Button busy={saving} onClick={() => void keepTrying()}>
            Save it and keep trying
          </Button>
        )}
      </div>
    </div>
  );
}

function Preview({ preview, onRestart }: { preview: Previewing; onRestart: () => void }) {
  const view = usePreview(preview.id);
  const result = view.data?.result ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const choice = touched ? picked : result ? firstChoice(result.choices) : null;
  const host = new URL(preview.url).host;

  if (view.isError) {
    return (
      <div className="max-w-xl space-y-4">
        <Notice tone="error">{view.error.message}</Notice>
        <Button onClick={onRestart}>Start again</Button>
      </div>
    );
  }
  if (view.data?.status === 'failed') {
    return (
      <div className="max-w-xl space-y-4">
        <Notice tone="error">The preview failed on our side. Please try again.</Notice>
        <Button onClick={onRestart}>Start again</Button>
      </div>
    );
  }
  if (!result) return <PreviewProgress view={view.data} host={host} />;

  const screenshot = result.screenshot;
  const choose = (index: number) => {
    setTouched(true);
    setPicked(index);
  };
  if (!screenshot || (result.choices.length === 0 && result.amount === null)) {
    return <Refused preview={preview} result={result} onRestart={onRestart} />;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-[15px]">
          {result.choices.some((c) => c.best)
            ? 'We’ve boxed every price on the page and picked the product’s own.'
            : 'We couldn’t tell which price is the product’s. Pick it on the screenshot.'}
          {result.plainHtmlWorks === false && (
            <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
              Checked in a browser
            </span>
          )}
        </p>
        <button type="button" onClick={onRestart} className="text-sm text-copper-deep underline">
          Use a different address
        </button>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        {result.choices.length > 0 ? (
          <ScreenshotFrame
            previewId={preview.id}
            result={{ ...result, screenshot }}
            choice={choice}
            onChoose={choose}
          />
        ) : (
          <Notice>
            Found {formatMoney(result.amount!, result.currency ?? 'GBP')} in the page’s structured
            data.
          </Notice>
        )}
        <div className="space-y-8">
          {result.choices.length > 0 && (
            <ChoiceList result={{ ...result, screenshot }} choice={choice} onChoose={choose} />
          )}
          <SaveForm preview={preview} result={result} choice={choice} onRestart={onRestart} />
        </div>
      </div>
    </div>
  );
}

export function AddPage() {
  const [preview, setPreview] = useState<Previewing | null>(null);
  return (
    <>
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">
          Add a product
        </h1>
        <Link to="/app" className={buttonClass('quiet')}>
          Cancel
        </Link>
      </div>
      {preview ? (
        <Preview key={preview.id} preview={preview} onRestart={() => setPreview(null)} />
      ) : (
        <AddressForm onPreview={setPreview} />
      )}
    </>
  );
}
