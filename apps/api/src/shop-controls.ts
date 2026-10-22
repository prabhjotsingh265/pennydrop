import { request } from 'node:http';

/** The practice shop's chaos settings for one host, as far as the demo needs them. */
export interface ShopSettings {
  layout: string;
  latencyMs: [number, number];
  errorRate: number;
  stock: string;
  sale: string;
  [setting: string]: unknown;
}

/** The practice shop's chaos controls, for one sandbox at a time. */
export interface ShopControls {
  state(host: string): Promise<ShopSettings>;
  change(host: string, patch: Record<string, unknown>): Promise<ShopSettings>;
  reset(host: string): Promise<ShopSettings>;
}

/**
 * Reaches the shop inside the network (it needn't be public), naming the
 * sandbox in the Host header, which Node's fetch won't send.
 */
export function shopControls(baseUrl: string, token?: string): ShopControls {
  const call = (method: string, path: string, host: string, body?: unknown) =>
    new Promise<ShopSettings>((resolve, reject) => {
      const url = new URL(`/_chaos${path}`, baseUrl);
      const text = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        url,
        {
          method,
          timeout: 5_000,
          headers: {
            host,
            ...(token ? { 'x-chaos-token': token } : {}),
            ...(text ? { 'content-type': 'application/json' } : {}),
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`The practice shop answered ${res.statusCode}.`));
              return;
            }
            resolve(JSON.parse(data) as ShopSettings);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('The practice shop didn’t answer.')));
      req.on('error', reject);
      req.end(text);
    });
  return {
    state: (host) => call('GET', '/state', host),
    change: (host, patch) => call('PUT', '/state', host, patch),
    reset: (host) => call('POST', '/reset', host),
  };
}
