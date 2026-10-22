import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_URL, harness } from '../test/harness.ts';

const h = harness();
beforeEach(() => h.reset());
afterAll(async () => {
  await h.app.close();
  await h.db.$disconnect();
});

function as(cookie: string) {
  const headers = { cookie, origin: APP_URL };
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    h.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  return {
    send,
    add: async (url: string) => (await send('POST', '/api/watches', { url })).json().watch,
    group: async (name: string) => (await send('POST', '/api/groups', { name })).json().group,
  };
}

describe('product groups', () => {
  it('puts the same item at several shops side by side', async () => {
    const me = as(await h.signIn());
    const kettle = await me.group('Copper kettle');
    const fickle = await me.add('https://fickle.example.com/p/kettle');
    const slowpoke = await me.add('https://slowpoke.example.com/p/kettle');
    await me.add('https://fickle.example.com/p/mug');
    for (const watch of [fickle, slowpoke]) {
      expect(
        (await me.send('PATCH', `/api/watches/${watch.id}`, { groupId: kettle.id })).statusCode,
      ).toBe(200);
    }
    await me.send('PATCH', `/api/watches/${fickle.id}`, { isMine: true });

    expect((await me.send('GET', '/api/groups')).json().groups).toEqual([
      { id: kettle.id, name: 'Copper kettle', products: 2 },
    ]);
    const detail = (await me.send('GET', `/api/groups/${kettle.id}`)).json();
    expect(detail.group.name).toBe('Copper kettle');
    // In the order they joined, so each keeps its colour.
    expect(
      detail.watches.map((w: { host: string; isMine: boolean; groupId: string }) => [
        w.host,
        w.isMine,
        w.groupId,
      ]),
    ).toEqual([
      ['fickle.example.com', true, kettle.id],
      ['slowpoke.example.com', false, kettle.id],
    ]);
  });

  it('renames a group, and deleting it keeps its products on the watchlist', async () => {
    const me = as(await h.signIn());
    const group = await me.group('Kettles');
    const watch = await me.add('https://fickle.example.com/p/kettle');
    await me.send('PATCH', `/api/watches/${watch.id}`, { groupId: group.id });

    expect(
      (await me.send('PATCH', `/api/groups/${group.id}`, { name: 'Copper kettles' })).json(),
    ).toEqual({
      group: { id: group.id, name: 'Copper kettles' },
    });
    expect((await me.send('DELETE', `/api/groups/${group.id}`)).statusCode).toBe(204);
    const after = (await me.send('GET', `/api/watches/${watch.id}`)).json().watch;
    expect(after.groupId).toBeNull();
  });

  it('takes a product out of its group', async () => {
    const me = as(await h.signIn());
    const group = await me.group('Kettles');
    const watch = await me.add('https://fickle.example.com/p/kettle');
    await me.send('PATCH', `/api/watches/${watch.id}`, { groupId: group.id });
    await me.send('PATCH', `/api/watches/${watch.id}`, { groupId: null });
    expect((await me.send('GET', `/api/groups/${group.id}`)).json().watches).toEqual([]);
  });

  it('keeps each workspace’s groups to itself', async () => {
    const mine = as(await h.signIn('a@example.com'));
    const theirs = as(await h.signIn('b@example.com'));
    const group = await mine.group('Kettles');
    const watch = await theirs.add('https://fickle.example.com/p/kettle');

    expect((await theirs.send('GET', `/api/groups/${group.id}`)).statusCode).toBe(404);
    expect((await theirs.send('PATCH', `/api/groups/${group.id}`, { name: 'x' })).statusCode).toBe(
      404,
    );
    expect((await theirs.send('DELETE', `/api/groups/${group.id}`)).statusCode).toBe(404);
    expect((await theirs.send('GET', '/api/groups')).json().groups).toEqual([]);
    // Nor can a product join another workspace's group.
    const joined = await theirs.send('PATCH', `/api/watches/${watch.id}`, { groupId: group.id });
    expect(joined.statusCode).toBe(422);
    expect(joined.json().field).toBe('groupId');
  });

  it('wants a name', async () => {
    const me = as(await h.signIn());
    expect((await me.send('POST', '/api/groups', { name: '  ' })).statusCode).toBe(422);
  });
});
