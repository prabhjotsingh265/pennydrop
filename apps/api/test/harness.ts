import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { vi } from 'vitest';
import type { Lookup } from '../src/addresses.ts';
import { buildApp } from '../src/app.ts';
import { createAuth } from '../src/auth.ts';
import type { Config } from '../src/config.ts';
import type { Email } from '../src/mail.ts';
import { FakePreviews } from './fake-previews.ts';

export const APP_URL = 'http://localhost:3000';

/** The API wired to its test database, with emails kept in memory instead of sent. */
export function harness() {
  const db = testDb('api');
  const sent: Email[] = [];
  const config: Config = {
    appUrl: APP_URL,
    authSecret: 'test-secret-that-is-long-enough-0123456789',
    mail: { from: 'Pennydrop <hello@pennydrop.test>' },
    localShops: false,
  };
  const wake = vi.fn(async () => {});
  // No real DNS in tests: names resolve to a public documentation address unless told otherwise.
  const resolved = new Map<string, string[]>();
  const lookup: Lookup = async (host) => resolved.get(host) ?? ['93.184.215.14'];
  const auth = createAuth({ db, mail: async (email) => void sent.push(email), config });
  const previews = new FakePreviews();
  const app = buildApp({ db, auth, config, wake, previews, lookup, logger: false });

  const cookiesFrom = (header: string | string[] | undefined) =>
    ([] as string[])
      .concat(header ?? [])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

  /** Signs up, confirms the email from the message it sent, and returns the session cookie. */
  async function signIn(email = 'prabhjot@example.com', name = 'Prabhjot'): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: APP_URL },
      payload: { name, email, password: 'correct horse battery', callbackURL: '/app' },
    });
    const message = sent.findLast((m) => m.to === email);
    const link = new URL(/https?:\/\/\S+/.exec(message?.text ?? '')![0]);
    const verified = await app.inject({ method: 'GET', url: `${link.pathname}${link.search}` });
    return cookiesFrom(verified.headers['set-cookie']);
  }

  return {
    app,
    db,
    sent,
    wake,
    resolved,
    previews,
    signIn,
    cookiesFrom,
    reset: () => resetDatabase(db),
  };
}
