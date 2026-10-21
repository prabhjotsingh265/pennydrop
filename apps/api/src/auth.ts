import type { Db } from '@pennydrop/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { Config } from './config.ts';
import type { Mailer } from './mail.ts';

const DAY = 86_400;

/**
 * Accounts: email and password, with the address confirmed before the first
 * sign-in. Every new account gets its own workspace straight away.
 */
export function createAuth({ db, mail, config }: { db: Db; mail: Mailer; config: Config }) {
  return betterAuth({
    appName: 'Pennydrop',
    baseURL: config.appUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [config.appUrl],
    database: prismaAdapter(db, { provider: 'postgresql' }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      autoSignIn: false,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mail({
          to: user.email,
          subject: 'Confirm your email for Pennydrop',
          text: `Hello ${user.name},\n\nConfirm your email to start watching prices:\n${url}\n\nIf you didn’t sign up, you can ignore this.`,
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.workspace.create({
              data: {
                name: 'My watchlist',
                memberships: { create: { userId: user.id, role: 'owner' } },
              },
            });
          },
        },
      },
    },
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    advanced: {
      cookiePrefix: 'pennydrop',
      useSecureCookies: config.appUrl.startsWith('https://'),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
