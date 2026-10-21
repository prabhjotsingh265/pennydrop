import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect, isIP, type AddressInfo } from 'node:net';
import { guardedLookup, isPublicAddress, type GuardOptions } from '@pennydrop/fetch';

export interface EgressProxy {
  /** Point the browser here: http://127.0.0.1:<port>. */
  url: string;
  /** Requests refused since the proxy started. */
  blocked(): number;
  close(): Promise<void>;
}

const WEB_PORTS = new Set([80, 443]);

/**
 * A forward proxy every request from the browser must go through. Each
 * upstream connection uses the same guarded lookup as the plain fetcher, so a
 * page's scripts, images and data calls can reach nothing the fetcher itself
 * couldn't: no private addresses, no metadata service, no odd ports.
 */
export async function startEgressProxy(options: GuardOptions): Promise<EgressProxy> {
  let refused = 0;
  const lookup = guardedLookup(options);

  // Ports and literal IP addresses are checked here; names are checked by the lookup.
  const allowed = (host: string, port: number) => {
    const plain = host.replace(/^\[|\]$/g, '');
    if (options.allowPrivate?.(plain)) return true;
    if (!WEB_PORTS.has(port)) return false;
    return !isIP(plain) || isPublicAddress(plain);
  };

  const server: Server = createServer((req, res) => {
    // Plain http: the browser sends the full address.
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      return void res.writeHead(400).end();
    }
    const port = Number(target.port || 80);
    if (target.protocol !== 'http:' || !allowed(target.hostname, port)) {
      refused++;
      return void res.writeHead(403).end();
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = httpRequest(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
        lookup: lookup as never,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      if ((error as { code?: string }).code === 'blocked-address') refused++;
      if (!res.headersSent) res.writeHead(403);
      res.end();
    });
    req.pipe(upstream);
  });

  // https: the browser asks for a tunnel to host:port.
  server.on('connect', (req, client, head) => {
    const { hostname, port: portText } = new URL(`https://${req.url ?? ''}`);
    const port = Number(portText || 443);
    const refuse = () => {
      refused++;
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    };
    if (!allowed(hostname, port)) return refuse();

    const upstream = connect({
      host: hostname.replace(/^\[|\]$/g, ''),
      port,
      lookup: lookup as never,
    });
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', (error) => {
      if ((error as { code?: string }).code === 'blocked-address') return refuse();
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    client.on('error', () => upstream.destroy());
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    blocked: () => refused,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
