import { useState } from 'react';
import { Link } from 'react-router';
import { authClient } from '../lib/auth-client.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';
import { AuthLayout } from './AuthLayout.tsx';

/** Asks for a reset link. The answer is the same whether or not the address has an account. */
export function Forgot() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  const send = async () => {
    setState('sending');
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: '/reset' });
    setState(error ? 'failed' : 'sent');
  };

  return (
    <AuthLayout title="Forgotten your password?">
      {state === 'sent' ? (
        <Notice>
          If an account uses <strong>{email}</strong>, a link to choose a new password is on its
          way. It works for an hour.
        </Notice>
      ) : (
        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {state === 'failed' && (
            <Notice tone="error">That didn’t go through. Please try again in a moment.</Notice>
          )}
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            busy={state === 'sending'}
            disabled={!email.includes('@')}
            className="w-full"
          >
            Send me a link
          </Button>
        </form>
      )}
      <p className="mt-8 text-sm text-ink-2">
        <Link to="/signin" className="font-medium text-copper-deep underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
