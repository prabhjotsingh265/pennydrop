import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

const h = harness();
beforeEach(() => {
  h.sent.length = 0;
  return h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

describe('GET /api/health', () => {
  it('answers ok', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('says which store it can’t reach, for an uptime monitor to notice', async () => {
    const down = harness({ redis: { ping: () => Promise.reject(new Error('ECONNREFUSED')) } });
    const response = await down.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'down', database: true, redis: false });
    await down.app.close();
    await down.db.$disconnect();
  });
});

describe('every answer', () => {
  it('carries the security headers, and isn’t cached unless a route says so', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'no-store',
    });
    // Better Auth's answers too.
    const auth = await h.app.inject({ method: 'GET', url: '/api/auth/get-session' });
    expect(auth.headers['x-frame-options']).toBe('DENY');
  });
});

describe('accounts', () => {
  it('asks a new account to confirm its email before it can sign in', async () => {
    const signUp = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: APP_URL },
      payload: {
        name: 'Prabhjot',
        email: 'prabhjot@example.com',
        password: 'correct horse battery',
      },
    });
    expect(signUp.statusCode).toBe(200);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      to: 'prabhjot@example.com',
      subject: 'Confirm your email for Pennydrop',
    });

    const early = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: APP_URL },
      payload: { email: 'prabhjot@example.com', password: 'correct horse battery' },
    });
    expect(early.statusCode).toBe(403);
  });

  it('refuses short passwords', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: APP_URL },
      payload: { name: 'P', email: 'p@example.com', password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('signs you in from the email link, into a workspace of your own', async () => {
    const cookie = await h.signIn();
    expect(cookie).toContain('pennydrop.session_token=');
    const me = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { name: 'Prabhjot', email: 'prabhjot@example.com' },
      workspace: { name: 'My watchlist' },
    });
  });

  it('turns away anyone not signed in', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
  });
});

describe('PATCH /api/workspace', () => {
  it('renames the workspace and sets its time zone', async () => {
    const cookie = await h.signIn();
    const response = await h.app.inject({
      method: 'PATCH',
      url: '/api/workspace',
      headers: { cookie, origin: APP_URL },
      payload: { name: 'Gifts', timezone: 'Asia/Kolkata' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().workspace).toMatchObject({
      name: 'Gifts',
      timezone: 'Asia/Kolkata',
      role: 'owner',
    });
  });

  it('says what was wrong with a bad time zone', async () => {
    const cookie = await h.signIn();
    const response = await h.app.inject({
      method: 'PATCH',
      url: '/api/workspace',
      headers: { cookie, origin: APP_URL },
      payload: { timezone: 'Mars/Olympus' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().issues[0].path).toEqual(['timezone']);
  });

  it('refuses changes that don’t come from the app itself, even with a valid session', async () => {
    const cookie = await h.signIn();
    for (const origin of ['https://evil.example.com', undefined]) {
      const forged = await h.app.inject({
        method: 'PATCH',
        url: '/api/workspace',
        headers: { cookie, ...(origin ? { origin } : {}) },
        payload: { name: 'Owned' },
      });
      expect(forged.statusCode).toBe(403);
    }
    const me = await h.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json().workspace.name).toBe('My watchlist');
  });
});
