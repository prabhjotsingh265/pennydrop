import { useLocation } from 'react-router';
import { AuthLayout } from './AuthLayout.tsx';

export function CheckEmail() {
  const email = (useLocation().state as { email?: string } | null)?.email;
  return (
    <AuthLayout title="Check your inbox">
      <p className="text-[15px] leading-relaxed">
        We’ve sent a link to {email ? <strong>{email}</strong> : 'your email address'}. Open it to
        confirm the address, and you’ll be signed straight in.
      </p>
      <p className="mt-4 text-sm text-ink-2">
        Nothing there after a minute? Look in your spam folder, or sign in to have it sent again.
      </p>
      {import.meta.env.DEV && (
        <p className="tabular mt-8 rounded-[8px] border border-dashed border-line p-3 text-[12px] text-ink-2">
          Running locally: every email lands in Mailpit at{' '}
          <a href="http://localhost:8026" className="text-copper-deep underline">
            localhost:8026
          </a>
          .
        </p>
      )}
    </AuthLayout>
  );
}
