import { createAuthClient } from 'better-auth/react';

/** Sign-up, sign-in and sign-out, through the API's /api/auth routes on this origin. */
export const authClient = createAuthClient({ basePath: '/api/auth' });
