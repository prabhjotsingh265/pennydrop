import type { WatchSummary } from '@pennydrop/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api.ts';
import { keys, useGroups, type useWatchActions } from '../../lib/queries.ts';
import { Button } from '../../ui/Button.tsx';

const NEW = 'new';

/** Which group this product is compared in, and whether it's your own listing. */
export function GroupControl({
  watch,
  actions,
}: {
  watch: WatchSummary;
  actions: ReturnType<typeof useWatchActions>;
}) {
  const groups = useGroups();
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(watch.label);
  const [problem, setProblem] = useState<string | null>(null);
  const group = groups.data?.find((g) => g.id === watch.groupId);

  const join = (groupId: string | null) =>
    actions.update.mutate(
      { groupId, ...(groupId ? {} : { isMine: false }) },
      {
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.groups }),
        onError: (error) => setProblem(error.message),
      },
    );

  const create = async () => {
    setProblem(null);
    try {
      const { group: created } = await api<{ group: { id: string } }>('/api/groups', {
        method: 'POST',
        body: { name },
      });
      setNaming(false);
      join(created.id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Not created.');
    }
  };

  return (
    <section aria-labelledby="compare-across" className="max-w-xl space-y-3">
      <h2 id="compare-across" className="text-[15px] font-semibold">
        Compare across shops
      </h2>
      <p className="text-[13px] text-ink-2">
        Put this with the same item from other shops to see them side by side.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="group" className="sr-only">
          Group
        </label>
        <select
          id="group"
          value={naming ? NEW : (watch.groupId ?? '')}
          onChange={(event) => {
            const value = event.target.value;
            if (value === NEW) setNaming(true);
            else {
              setNaming(false);
              join(value || null);
            }
          }}
          className="h-10 min-w-56 rounded-[8px] border border-line bg-paper px-3 text-sm"
        >
          <option value="">Not in a group</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value={NEW}>New group…</option>
        </select>
        {group && (
          <Link to={`/app/groups/${group.id}`} className="text-sm text-copper-deep underline">
            Compare {group.products} {group.products === 1 ? 'shop' : 'shops'}
          </Link>
        )}
      </div>
      {naming && (
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label htmlFor="group-name" className="sr-only">
            Group name
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-10 min-w-56 rounded-[8px] border border-line bg-paper px-3 text-sm"
          />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Create and add
          </Button>
        </form>
      )}
      {watch.groupId && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={watch.isMine}
            onChange={(event) => actions.update.mutate({ isMine: event.target.checked })}
            className="accent-[var(--copper-deep)]"
          />
          This is my own listing: tell me who undercuts it
        </label>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </section>
  );
}
