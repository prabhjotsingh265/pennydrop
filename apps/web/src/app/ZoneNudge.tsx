import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { keys, useMe } from '../lib/queries.ts';
import { deviceZone, sameZone, zoneName } from '../lib/zones.ts';
import { Button } from '../ui/Button.tsx';

const KEY = 'pennydrop:zone-nudge-dismissed';

function dismissedFor(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/**
 * New workspaces start on London time. When this device is somewhere else,
 * offer to switch, once: saying no is remembered on this device.
 */
export function ZoneNudge() {
  const me = useMe().data;
  const queryClient = useQueryClient();
  const device = deviceZone();
  const [hidden, setHidden] = useState(() => dismissedFor() === device);
  const [saving, setSaving] = useState(false);
  if (!me || hidden || me.workspace.role !== 'owner' || sameZone(me.workspace.timezone, device)) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, device);
    } catch {
      // Not remembered; it simply asks again next visit.
    }
    setHidden(true);
  };
  const switchZone = async () => {
    setSaving(true);
    try {
      const updated = await api('/api/workspace', { method: 'PATCH', body: { timezone: device } });
      queryClient.setQueryData(keys.me, updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm sm:px-6">
        <p className="mr-auto">
          Times are shown in <strong>{zoneName(me.workspace.timezone)}</strong>. This device is in{' '}
          <strong>{zoneName(device)}</strong>.
        </p>
        <Button variant="primary" className="h-8" busy={saving} onClick={() => void switchZone()}>
          Use {zoneName(device)}
        </Button>
        <button type="button" onClick={dismiss} className="text-ink-2 underline">
          Keep it
        </button>
      </div>
    </div>
  );
}
