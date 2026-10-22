import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api.ts';
import { keys, useGroups } from '../lib/queries.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';

/** Groups: the same item at several shops, to compare. */
export function GroupsPage() {
  const groups = useGroups();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { group } = await api<{ group: { id: string } }>('/api/groups', {
        method: 'POST',
        body: { name },
      });
      await queryClient.invalidateQueries({ queryKey: keys.groups });
      navigate(`/app/groups/${group.id}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Not created.');
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">Compare</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          Put the same item from several shops in a group to see them side by side, cheapest first.
          Mark one as your own listing to see who undercuts you.
        </p>
      </div>

      {groups.isPending ? (
        <div className="h-24 animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      ) : groups.isError ? (
        <Notice tone="error">{groups.error.message}</Notice>
      ) : groups.data.length === 0 ? (
        <p className="text-sm text-ink-2">No groups yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-[14px] border border-line">
          {groups.data.map((group) => (
            <li key={group.id}>
              <Link
                to={`/app/groups/${group.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface"
              >
                <span className="font-medium">{group.name}</span>
                <span className="tabular text-[12px] text-ink-2">
                  {group.products} {group.products === 1 ? 'shop' : 'shops'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field
          label="New group"
          placeholder="Copper kettle"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={problem ?? undefined}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!name.trim()}
          className="sm:mt-[26px]"
        >
          Create
        </Button>
      </form>
      <p className="text-[13px] text-ink-2">
        Then open each product and choose this group under “Compare across shops”.
      </p>
    </div>
  );
}
