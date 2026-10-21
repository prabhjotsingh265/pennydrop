import { createServer, request, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from './egress-proxy.ts';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function proxy(options: Parameters<typeof startEgressProxy>[0] = {}): Promise<EgressProxy> {
  const started = await startEgressProxy(options);
  cleanup.push(() => started.close());
  return started;
}

async function site(): Promise<number> {
  const server: Server = createServer((_req, res) => res.end('hello from the shop'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return (server.address() as AddressInfo).port;
}

const port = (url: string) => Number(new URL(url).port);

/** A plain http request the way a browser sends it to a proxy: the full address as the path. */
function viaProxy(proxyUrl: string, target: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: port(proxyUrl),
        path: target,
        headers: { host: new URL(target).host },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Asks the proxy for an https tunnel and reports its answer. */
function tunnel(proxyUrl: string, target: string): Promise<{ status: number; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: port(proxyUrl),
      method: 'CONNECT',
      path: target,
    });
    req.on('connect', (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
    req.on('error', reject);
    req.end();
  });
}

const privateDns = async () => [{ address: '10.0.0.5', family: 4 }];

describe('the egress proxy', () => {
  it('forwards plain http to a site it may reach', async () => {
    const shop = await site();
    const egress = await proxy({ allowPrivate: (host) => host === 'localhost' });
    expect(await viaProxy(egress.url, `http://localhost:${shop}/p/mug`)).toEqual({
      status: 200,
      body: 'hello from the shop',
    });
  });

  it('refuses the cloud metadata address and private networks', async () => {
    const egress = await proxy();
    expect((await viaProxy(egress.url, 'http://169.254.169.254/latest/meta-data/')).status).toBe(
      403,
    );
    expect((await tunnel(egress.url, '10.0.0.5:443')).status).toBe(403);
    expect(egress.blocked()).toBe(2);
  });

  it('refuses a name that resolves to a private address, over http and https', async () => {
    const egress = await proxy({ resolve: privateDns });
    expect((await viaProxy(egress.url, 'http://evil.test/')).status).toBe(403);
    expect((await tunnel(egress.url, 'evil.test:443')).status).toBe(403);
  });

  it('refuses ports web pages aren’t served on', async () => {
    const egress = await proxy();
    expect((await tunnel(egress.url, 'example.com:22')).status).toBe(403);
  });

  it('opens a working tunnel where it’s allowed', async () => {
    const shop = await site();
    const egress = await proxy({ allowPrivate: (host) => host === 'localhost' });
    const { status, socket } = await tunnel(egress.url, `localhost:${shop}`);
    expect(status).toBe(200);
    const reply = await new Promise<string>((resolve) => {
      let text = '';
      socket.on('data', (chunk) => (text += chunk));
      socket.on('end', () => resolve(text));
      socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    expect(reply).toContain('hello from the shop');
  });
});
