import { MIN_PASSWORD_LENGTH } from '@pennydrop/domain';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../lib/auth-client.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';
import { AuthLayout } from './AuthLayout.tsx';

/** Where the emailed link lands: choose a new password. */
export function Reset() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const save = async () => {
    if (!token) return;
    setBusy(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) {
      setFailed(true);
      setBusy(false);
      return;
    }
    navigate('/signin', {
      replace: true,
      state: { notice: 'Password changed. Sign in with the new one.' },
    });
  };

  // The link checks its token first, and arrives with an error if it was stale or used.
  if (!token || params.get('error') || failed) {
    return (
      <AuthLayout title="That link has expired">
        <Notice tone="error">
          Reset links work once, for an hour. Ask for a new one and use the latest email.
        </Notice>
        <p className="mt-8 text-sm">
          <Link to="/forgot" className="font-medium text-copper-deep underline">
            Send a new link
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password">
      <form
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. It signs you out everywhere else.`}
          error={tooShort ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
        />
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={password.length < MIN_PASSWORD_LENGTH}
          className="w-full"
        >
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}
