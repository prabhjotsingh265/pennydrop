import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { minutesToTime, timeToMinutes } from '../lib/alerts.ts';
import { api } from '../lib/api.ts';
import { keys, useMe } from '../lib/queries.ts';
import { zoneName } from '../lib/zones.ts';
import { Button } from '../ui/Button.tsx';
import { Switch } from '../ui/Switch.tsx';

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] text-ink-2">
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="tabular h-10 rounded-[8px] border border-line bg-paper px-3 text-sm outline-none focus:border-copper-deep disabled:opacity-60"
      />
    </div>
  );
}

/** When alerts may arrive: quiet hours hold them overnight; the digest gathers a day's into one. */
export function AlertTiming() {
  const me = useMe().data!;
  const { workspace } = me;
  const queryClient = useQueryClient();
  const owner = workspace.role === 'owner';
  const [quiet, setQuiet] = useState(workspace.quietFrom !== null);
  const [from, setFrom] = useState(minutesToTime(workspace.quietFrom ?? 22 * 60));
  const [until, setUntil] = useState(minutesToTime(workspace.quietUntil ?? 7 * 60));
  const [digest, setDigest] = useState(workspace.digest);
  const [digestAt, setDigestAt] = useState(minutesToTime(workspace.digestAt));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');

  const save = async () => {
    const quietFrom = timeToMinutes(from);
    const quietUntil = timeToMinutes(until);
    const at = timeToMinutes(digestAt);
    if ((quiet && (quietFrom === null || quietUntil === null)) || at === null) {
      setState('Give each time as hours and minutes.');
      return;
    }
    setState('saving');
    try {
      const updated = await api('/api/workspace', {
        method: 'PATCH',
        body: {
          quietFrom: quiet ? quietFrom : null,
          quietUntil: quiet ? quietUntil : null,
          digest,
          digestAt: at,
        },
      });
      queryClient.setQueryData(keys.me, updated);
      setState('saved');
    } catch (error) {
      setState(error instanceof Error ? error.message : 'Not saved.');
    }
  };

  return (
    <section aria-labelledby="timing" className="space-y-6">
      <div>
        <h2 id="timing" className="text-[15px] font-semibold">
          When alerts arrive
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          For alerts sent to your channels, in the workspace’s time zone (
          {zoneName(workspace.timezone)}). The inbox here always shows them at once.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Quiet hours</p>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {digest
                ? 'Not needed while alerts come as one summary a day.'
                : 'Alerts wait, and arrive together as one message when quiet hours end.'}
            </p>
          </div>
          <Switch
            checked={quiet}
            onChange={setQuiet}
            label="Quiet hours"
            disabled={!owner || digest}
          />
        </div>
        {quiet && !digest && (
          <div className="flex flex-wrap gap-4">
            <TimeField label="From" value={from} onChange={setFrom} disabled={!owner} />
            <TimeField label="Until" value={until} onChange={setUntil} disabled={!owner} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">One summary a day</p>
            <p className="mt-0.5 text-[13px] text-ink-2">
              Instead of each alert as it happens, a single message with the day’s alerts.
            </p>
          </div>
          <Switch
            checked={digest}
            onChange={setDigest}
            label="One summary a day"
            disabled={!owner}
          />
        </div>
        {digest && (
          <TimeField label="Sent at" value={digestAt} onChange={setDigestAt} disabled={!owner} />
        )}
      </div>

      {owner && (
        <div className="flex items-center gap-3">
          <Button variant="primary" busy={state === 'saving'} onClick={() => void save()}>
            Save alert times
          </Button>
          {state === 'saved' && (
            <span role="status" className="text-sm text-ink-2">
              Saved.
            </span>
          )}
          {state !== 'idle' && state !== 'saving' && state !== 'saved' && (
            <span role="alert" className="text-sm text-danger">
              {state}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
