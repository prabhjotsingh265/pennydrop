import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { authClient } from '../lib/auth-client.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';

/** Deleting the account, its workspace and watches, after the password is given. */
export function DeleteAccount() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    const { error } = await authClient.deleteUser({ password });
    if (error) {
      setProblem('That password isn’t right.');
      setBusy(false);
      return;
    }
    navigate('/signin', {
      replace: true,
      state: { notice: 'Your account, its watchlist and its alerts have been deleted.' },
    });
    queryClient.clear();
  };

  return (
    <section
      aria-labelledby="delete-account"
      className="rounded-[14px] border border-danger/30 p-4"
    >
      <h2 id="delete-account" className="text-[15px] font-semibold">
        Delete your account
      </h2>
      <p className="mt-1 text-[13px] text-ink-2">
        Your workspace and everything in it go for good. Download your data first if you want it.
      </p>
      {open ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void remove();
          }}
        >
          <Field
            label="Your password, to confirm"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={problem ?? undefined}
          />
          <div className="flex gap-3">
            <Button type="submit" variant="danger" busy={busy} disabled={!password}>
              Delete everything
            </Button>
            <Button onClick={() => setOpen(false)}>Keep my account</Button>
          </div>
        </form>
      ) : (
        <Button variant="danger" className="mt-4" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      )}
    </section>
  );
}
