import { INTERVALS, minorUnitsFrom, type WatchSummary } from '@pennydrop/domain';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '../../lib/api.ts';
import { minorDigits } from '../../lib/money.ts';
import type { useWatchActions } from '../../lib/queries.ts';
import { every } from '../../lib/time.ts';
import { Button } from '../../ui/Button.tsx';
import { Field } from '../../ui/Field.tsx';
import { Notice } from '../../ui/Notice.tsx';

interface Values {
  label: string;
  target: string;
  interval: string;
}

const plain = (minor: number, currency: string) =>
  (minor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency));

/** The product's name, target and how often it's checked; and removing it. */
export function Settings({
  watch,
  actions,
  onRemoved,
}: {
  watch: WatchSummary;
  actions: ReturnType<typeof useWatchActions>;
  onRemoved: () => void;
}) {
  const currency = watch.currency ?? 'GBP';
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const form = useForm<Values>({
    // Kept in step with the product: a target dragged on the chart shows up here too.
    values: {
      label: watch.label,
      target: watch.targetPrice === null ? '' : plain(watch.targetPrice, currency),
      interval: String(watch.intervalSeconds),
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false);
    const target = values.target.trim() ? minorUnitsFrom(values.target, currency) : null;
    if (values.target.trim() && target === null) {
      form.setError('target', { message: 'That doesn’t look like a price.' });
      return;
    }
    try {
      await actions.update.mutateAsync({
        label: values.label.trim() || null,
        targetPrice: target,
        intervalSeconds: Number(values.interval) as (typeof INTERVALS)[number],
      });
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.field === 'intervalSeconds') {
        form.setError('interval', { message: error.message });
      } else {
        form.setError('root', { message: error instanceof Error ? error.message : 'Not saved.' });
      }
    }
  });

  const remove = async () => {
    await actions.remove.mutateAsync();
    onRemoved();
  };

  return (
    <section aria-labelledby="settings" className="max-w-xl">
      <h2 id="settings" className="text-[15px] font-semibold">
        Settings
      </h2>
      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-5">
        {errors.root && <Notice tone="error">{errors.root.message}</Notice>}
        <Field label="Name" error={errors.label?.message} {...form.register('label')} />
        <Field
          label="Tell me when it drops to"
          inputMode="decimal"
          hint="Leave it empty to just follow the price."
          error={errors.target?.message}
          {...form.register('target')}
        />
        <div>
          <label htmlFor="settings-interval" className="mb-1.5 block text-sm font-medium">
            Check it
          </label>
          <select
            id="settings-interval"
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
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" busy={isSubmitting}>
            Save changes
          </Button>
          {saved && (
            <span role="status" className="text-sm text-ink-2">
              Saved.
            </span>
          )}
        </div>
      </form>

      <div className="mt-10 rounded-[14px] border border-line p-4">
        {confirming ? (
          <div className="space-y-3">
            <p className="text-sm">
              Remove it from your watchlist? Its price history stays, in case you add it again.
            </p>
            <div className="flex gap-3">
              <Button
                variant="danger"
                busy={actions.remove.isPending}
                onClick={() => void remove()}
              >
                Remove
              </Button>
              <Button onClick={() => setConfirming(false)}>Keep it</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">Done with this one?</p>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Remove from watchlist
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
