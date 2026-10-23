import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetDatabase, testDb } from '@pennydrop/db/testing';
import { vi } from 'vitest';
import type { Lookup } from '../src/addresses.ts';
import { buildApp, type AppDeps } from '../src/app.ts';
import { unlimited, type Limiter } from '../src/limits.ts';
import type { Queue } from 'bullmq';
import { createAuth } from '../src/auth.ts';
import { LiveHub } from '../src/live.ts';
import type { Config } from '../src/config.ts';
import type { Email } from '@pennydrop/alerts';
import { FakePreviews } from './fake-previews.ts';
import { FakeShop } from './fake-shop.ts';

export const APP_URL = 'http://localhost:3000';

/** The API wired to its test database, with emails kept in memory instead of sent. */
export function harness({
  limiter = unlimited,
  queues,
  webDist,
  redis,
}: {
  limiter?: Limiter;
  queues?: Record<string, Queue>;
  webDist?: string;
  redis?: AppDeps['redis'];
} = {}) {
  const db = testDb('api');
  const sent: Email[] = [];
  const config: Config = {
    appUrl: APP_URL,
    authSecret: 'test-secret-that-is-long-enough-0123456789',
    mail: { from: 'Pennydrop <hello@pennydrop.test>' },
    localShops: false,
    channelsKey: 'test-channels-key',
    screenshotDir: mkdtempSync(join(tmpdir(), 'pennydrop-api-shots-')),
    webDist,
    trustProxy: false,
    demo: {
      practiceShopUrl: 'http://{shop}.localhost:4000',
      shopInternalUrl: 'http://shop.test:4000',
    },
    adminEmails: ['admin@example.com'],
  };
  const wake = vi.fn(async () => {});
  // No real DNS in tests: names resolve to a public documentation address unless told otherwise.
  const resolved = new Map<string, string[]>();
  const lookup: Lookup = async (host) => resolved.get(host) ?? ['93.184.215.14'];
  const mail = async (email: Email) => void sent.push(email);
  const auth = createAuth({ db, mail, config });
  const previews = new FakePreviews();
  const shop = new FakeShop();
  // One process, so "publishing" is handing the message straight to the hub.
  const live = new LiveHub(db);
  const published: unknown[] = [];
  const publish = async (message: Parameters<LiveHub['receive']>[0]) => {
    published.push(message);
    await live.receive(message);
  };
  const app = buildApp({
    db,
    auth,
    config,
    wake,
    previews,
    live,
    publish,
    mail,
    limiter,
    shop,
    queues,
    redis,
    lookup,
    logger: false,
  });

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
    shop,
    screenshotDir: config.screenshotDir!,
    live,
    published,
    signIn,
    cookiesFrom,
    reset: () => resetDatabase(db),
  };
}
