import { syncTarget, type Db } from '@pennydrop/db';
import { MIN_PASSWORD_LENGTH } from '@pennydrop/domain';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { Config } from './config.ts';
import { channelKey, hintFor, seal, type Mailer } from '@pennydrop/alerts';

const DAY = 86_400;

/**
 * Deleting an account takes its own workspaces with it (their watches, groups
 * and memberships go too). A product page someone else still watches stays;
 * one nobody watches any more is paused, its history kept.
 */
export async function removeWorkspacesOf(db: Db, userId: string): Promise<void> {
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: { include: { _count: { select: { memberships: true } } } } },
  });
  const own = memberships.filter((m) => m.workspace._count.memberships === 1);
  const targets = await db.watch.findMany({
    where: { workspaceId: { in: own.map((m) => m.workspaceId) } },
    select: { targetId: true },
  });
  await db.workspace.deleteMany({ where: { id: { in: own.map((m) => m.workspaceId) } } });
  for (const targetId of new Set(targets.map((t) => t.targetId))) await syncTarget(db, targetId);
}

/**
 * Accounts: email and password, with the address confirmed before the first
 * sign-in. Every new account gets its own workspace straight away.
 */
export function createAuth({ db, mail, config }: { db: Db; mail: Mailer; config: Config }) {
  const key = channelKey(config.channelsKey);
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
      minPasswordLength: MIN_PASSWORD_LENGTH,
      autoSignIn: false,
      sendResetPassword: async ({ user, url }) => {
        await mail({
          to: user.email,
          subject: 'Reset your Pennydrop password',
          text: `Hello ${user.name},\n\nChoose a new password here (the link works for an hour):\n${url}\n\nIf you didn’t ask for this, you can ignore it: your password stays as it is.`,
        });
      },
      // A new password signs out everywhere else: a stolen session dies with the old one.
      revokeSessionsOnPasswordReset: true,
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
            const email = { kind: 'email' as const, address: user.email };
            await db.workspace.create({
              data: {
                name: 'My watchlist',
                memberships: { create: { userId: user.id, role: 'owner' } },
                // Alerts can reach you from the start: by email, to the address you signed up with.
                channels: {
                  create: {
                    kind: 'email',
                    name: 'My email',
                    settings: seal(email, key),
                    hint: hintFor(email),
                  },
                },
              },
            });
          },
        },
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => removeWorkspacesOf(db, user.id),
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
