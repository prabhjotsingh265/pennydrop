import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { keys, useMe } from '../lib/queries.ts';
import {
  allZones,
  canonicalZone,
  deviceZone,
  sameZone,
  zoneLabel,
  zoneName,
} from '../lib/zones.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';
import { AlertTiming } from './AlertTiming.tsx';
import { DeleteAccount } from './DeleteAccount.tsx';

/** The workspace's name and time zone, the account, and taking your data with you. */
export function SettingsPage() {
  const me = useMe().data!;
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.workspace.name);
  // The list uses the browser's spelling, so the saved zone is looked up that way too.
  const [zone, setZone] = useState(canonicalZone(me.workspace.timezone));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const device = deviceZone();
  const owner = me.workspace.role === 'owner';

  const save = async () => {
    setState('saving');
    try {
      const updated = await api('/api/workspace', {
        method: 'PATCH',
        body: { name: name.trim(), timezone: zone },
      });
      queryClient.setQueryData(keys.me, updated);
      setState('saved');
    } catch (error) {
      setState(error instanceof Error ? error.message : 'Not saved.');
    }
  };

  return (
    <div className="max-w-xl space-y-12">
      <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">Settings</h1>

      <section aria-labelledby="workspace" className="space-y-5">
        <h2 id="workspace" className="text-[15px] font-semibold">
          Workspace
        </h2>
        {!owner && <Notice>Only the workspace’s owner can change these.</Notice>}
        <Field
          label="Name"
          value={name}
          disabled={!owner}
          onChange={(event) => setName(event.target.value)}
        />
        <div>
          <label htmlFor="zone" className="mb-1.5 block text-sm font-medium">
            Time zone
          </label>
          <select
            id="zone"
            value={zone}
            disabled={!owner}
            onChange={(event) => setZone(event.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-paper px-3 text-[15px]"
          >
            {allZones().map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z)}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[13px] text-ink-2">
            Times on the dashboard are shown in this zone.
            {!sameZone(zone, device) && (
              <>
                {' '}
                <button
                  type="button"
                  disabled={!owner}
                  onClick={() => setZone(canonicalZone(device))}
                  className="text-copper-deep underline"
                >
                  Use this device’s ({zoneName(device)})
                </button>
              </>
            )}
          </p>
        </div>
        {owner && (
          <div className="flex items-center gap-3">
            <Button variant="primary" busy={state === 'saving'} onClick={() => void save()}>
              Save changes
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

      <AlertTiming />

      <section aria-labelledby="account" className="space-y-2">
        <h2 id="account" className="text-[15px] font-semibold">
          Account
        </h2>
        <p className="text-sm">{me.user.name}</p>
        <p className="text-sm text-ink-2">{me.user.email}</p>
      </section>

      <section aria-labelledby="export" className="space-y-2">
        <h2 id="export" className="text-[15px] font-semibold">
          Your data
        </h2>
        <p className="text-sm text-ink-2">
          Take your products and every price they’ve had with you, as spreadsheets.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <a href="/api/export" download className="text-sm text-copper-deep underline">
            Download everything (ZIP of spreadsheets)
          </a>
          <a href="/api/watches.csv" download className="text-sm text-copper-deep underline">
            Just the watchlist (CSV)
          </a>
        </div>
      </section>

      <DeleteAccount />
    </div>
  );
}
