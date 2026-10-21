import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

const h = harness();
beforeEach(async () => {
  h.published.length = 0;
  await h.reset();
});
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

const MUG = 'https://fickle.example.com/p/stoneware-mug';

async function add(cookie: string, url = MUG) {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/watches',
    headers: { cookie, origin: APP_URL },
    payload: { url },
  });
  return response.json().watch as { id: string; targetId: string };
}

function listener() {
  const events: { event: string; data: unknown }[] = [];
  return {
    events,
    client: {
      send: (event: string, data: unknown) => void events.push({ event, data }),
      ping: () => {},
      end: () => {},
    },
  };
}

async function workspaceOf(email: string) {
  const user = await h.db.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: true },
  });
  return user.memberships[0]!.workspaceId;
}

describe('the live hub', () => {
  it('tells only the workspaces watching a page that it was checked', async () => {
    const a = await h.signIn('a@example.com');
    await h.signIn('b@example.com');
    const watch = await add(a);
    const mine = listener();
    const theirs = listener();
    await h.live.connect(await workspaceOf('a@example.com'), mine.client);
    await h.live.connect(await workspaceOf('b@example.com'), theirs.client);

    await h.live.receive({
      type: 'checked',
      targetId: watch.targetId,
      outcome: 'ok',
      priceChanged: true,
    });
    expect(mine.events).toEqual([
      { event: 'checked', data: { watchId: watch.id, outcome: 'ok', priceChanged: true } },
    ]);
    expect(theirs.events).toEqual([]);
  });

  it('starts passing on a page’s checks once the workspace adds it, from any tab', async () => {
    const b = await h.signIn('b@example.com');
    const theirs = listener();
    const disconnect = await h.live.connect(await workspaceOf('b@example.com'), theirs.client);

    const watch = await add(b);
    expect(h.published).toContainEqual({
      type: 'watches',
      workspaceId: await workspaceOf('b@example.com'),
    });
    expect(theirs.events.map((e) => e.event)).toEqual(['watches']);

    await h.live.receive({
      type: 'checked',
      targetId: watch.targetId,
      outcome: 'ok',
      priceChanged: false,
    });
    expect(theirs.events.map((e) => e.event)).toEqual(['watches', 'checked']);

    disconnect();
    await h.live.receive({
      type: 'checked',
      targetId: watch.targetId,
      outcome: 'ok',
      priceChanged: false,
    });
    expect(theirs.events).toHaveLength(2);
  });
});

describe('GET /api/events', () => {
  it('streams a signed-in dashboard’s updates as Server-Sent Events', async () => {
    const cookie = await h.signIn();
    const watch = await add(cookie);
    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = h.app.server.address() as AddressInfo;

    // Other tests' listeners may still be in the hub: count from here.
    const before = h.live.size;
    const abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { cookie },
      signal: abort.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`The stream ended before "${needle}": ${JSON.stringify(text)}`);
        text += decoder.decode(value);
      }
    };
    await readUntil('retry: 5000');

    // The connection registers just after the headers go out.
    for (let i = 0; i < 50 && h.live.size === before; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await h.live.receive({
      type: 'checked',
      targetId: watch.targetId,
      outcome: 'ok',
      priceChanged: true,
    });
    await readUntil('event: checked');
    expect(text).toContain(`"watchId":"${watch.id}"`);

    abort.abort();
    for (let i = 0; i < 50 && h.live.size > before; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(h.live.size).toBe(before);
  });

  it('turns away anyone not signed in', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/events' });
    expect(response.statusCode).toBe(401);
  });
});
