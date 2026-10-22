import { createAuthClient } from 'better-auth/react';

/** Sign-up, sign-in and sign-out, through the API's /api/auth routes on this origin. */
export const authClient = createAuthClient({ basePath: '/api/auth' });

/** The API's own words when there have been too many tries ("Please wait 10 minutes…"), or null. */
export function tooManyTries(error: { status: number; message?: string } | null): string | null {
  return error?.status === 429 ? (error.message ?? 'Too many tries. Please wait a while.') : null;
}
