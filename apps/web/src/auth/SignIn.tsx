import { zodResolver } from '@hookform/resolvers/zod';
import { signInSchema, type SignInInput } from '@pennydrop/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { authClient } from '../lib/auth-client.ts';
import { fetchMe, keys } from '../lib/queries.ts';
import { safeNext } from '../lib/time.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';
import { AuthLayout } from './AuthLayout.tsx';

export function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  // A message carried over from where they came from: a new password, a deleted account.
  const carried = (useLocation().state as { notice?: string } | null)?.notice;
  const [problem, setProblem] = useState<'wrong' | 'unconfirmed' | 'other' | null>(null);
  const [resent, setResent] = useState(false);
  const form = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email, password }) => {
    setProblem(null);
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setProblem(
        error.code === 'EMAIL_NOT_VERIFIED'
          ? 'unconfirmed'
          : error.code === 'INVALID_EMAIL_OR_PASSWORD'
            ? 'wrong'
            : 'other',
      );
      return;
    }
    // Learn who's signed in before going on: the dashboard's guard still remembers
    // "nobody" from before, and would send them straight back here.
    await queryClient.fetchQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 0 });
    navigate(safeNext(params.get('next')), { replace: true });
  });

  const resend = async () => {
    await authClient.sendVerificationEmail({
      email: form.getValues('email'),
      callbackURL: '/app',
    });
    setResent(true);
  };

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {carried && !problem && <Notice>{carried}</Notice>}
        {problem === 'wrong' && (
          <Notice tone="error">That email and password don’t match an account.</Notice>
        )}
        {problem === 'unconfirmed' && (
          <Notice>
            Please confirm your email first: the link is in the message we sent.{' '}
            {resent ? (
              'We’ve sent it again.'
            ) : (
              <button
                type="button"
                onClick={resend}
                className="font-medium text-copper-deep underline"
              >
                Send it again
              </button>
            )}
          </Notice>
        )}
        {problem === 'other' && (
          <Notice tone="error">We couldn’t sign you in just now. Please try again.</Notice>
        )}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" variant="primary" busy={isSubmitting} className="w-full">
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot" className="text-ink-2 underline hover:text-ink">
            Forgotten your password?
          </Link>
        </p>
      </form>
      <p className="mt-8 text-sm text-ink-2">
        New here?{' '}
        <Link to="/signup" className="font-medium text-copper-deep underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
