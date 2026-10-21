import { zodResolver } from '@hookform/resolvers/zod';
import { MIN_PASSWORD_LENGTH, signUpSchema, type SignUpInput } from '@pennydrop/domain';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { authClient } from '../lib/auth-client.ts';
import { Button } from '../ui/Button.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';
import { AuthLayout } from './AuthLayout.tsx';

export function SignUp() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const form = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (input) => {
    setFailed(false);
    const { error } = await authClient.signUp.email({ ...input, callbackURL: '/app' });
    if (error?.code?.startsWith('USER_ALREADY_EXISTS')) {
      form.setError('email', { message: 'There’s already an account with this email.' });
      return;
    }
    if (error) {
      setFailed(true);
      return;
    }
    navigate('/signup/sent', { state: { email: input.email } });
  });

  return (
    <AuthLayout title="Create your account">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {failed && (
          <Notice tone="error">We couldn’t create your account just now. Please try again.</Notice>
        )}
        <Field
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...form.register('name')}
        />
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
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short sentence works well.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" variant="primary" busy={isSubmitting} className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-8 text-sm text-ink-2">
        Already have one?{' '}
        <Link to="/signin" className="font-medium text-copper-deep underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
