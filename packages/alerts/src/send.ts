import { isIP } from 'node:net';
import { guardedLookup, isPublicAddress, type GuardOptions } from '@pennydrop/fetch';
import { Agent, request } from 'undici';
import type { ChannelSettings } from './channels.ts';
import { sign } from './crypto.ts';
import type { Mailer } from './mail.ts';
import type { Message } from './messages.ts';

export interface SendDeps {
  mail: Mailer;
  guard: GuardOptions;
  userAgent: string;
  timeoutMs?: number;
  now?: () => number;
}

export type SendResult =
  | { ok: true }
  /** Permanent: retrying won't help (a revoked webhook, an address we refuse). */
  | { ok: false; permanent: boolean; error: string };

/** Whether an error, however deep undici wrapped it, carries this code. */
function codeIn(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: string }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Only http(s) on the usual ports, unless the host is trusted (the practice
 * shop, locally). An address written as an IP is checked here: Node connects
 * to one without a DNS lookup, so the guarded lookup would never see it.
 */
function allowed(url: URL, guard: GuardOptions): string | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return 'Only web addresses can be sent to.';
  const trusted = guard.allowPrivate?.(url.hostname) ?? false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!trusted && isIP(host) && !isPublicAddress(host))
    return 'That address is inside a private network.';
  if (!trusted && url.port !== '' && url.port !== '443' && url.port !== '80') {
    return `Port ${url.port} isn’t allowed.`;
  }
  return null;
}

/**
 * One message to one channel. Web requests go through the same guarded DNS
 * lookup as page checks, so a webhook can't reach a private network; they
 * never follow redirects, and give up after the timeout.
 */
export async function send(
  settings: ChannelSettings,
  message: Message,
  deliveryId: string,
  deps: SendDeps,
): Promise<SendResult> {
  if (settings.kind === 'email') {
    try {
      await deps.mail({
        to: settings.address,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, permanent: false, error: (error as Error).message };
    }
  }

  const url = new URL(settings.url);
  const refused = allowed(url, deps.guard);
  if (refused) return { ok: false, permanent: true, error: refused };
  const body = JSON.stringify(
    settings.kind === 'slack'
      ? message.slack
      : settings.kind === 'discord'
        ? message.discord
        : { ...message.webhook, deliveryId },
  );
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': deps.userAgent,
  };
  if (settings.kind === 'webhook') {
    headers['pennydrop-delivery'] = deliveryId;
    headers['pennydrop-signature'] = sign(
      body,
      settings.secret,
      Math.floor((deps.now?.() ?? Date.now()) / 1000),
    );
  }

  const timeout = deps.timeoutMs ?? 10_000;
  // The guarded lookup answers as Node's lookup does; undici's types are narrower (as in fetchPage).
  const connect = { lookup: guardedLookup(deps.guard), timeout } as NonNullable<
    ConstructorParameters<typeof Agent>[0]
  >['connect'];
  const agent = new Agent({ connect });
  try {
    const response = await request(url, {
      method: 'POST',
      body,
      headers,
      dispatcher: agent,
      headersTimeout: timeout,
      bodyTimeout: timeout,
    });
    await response.body.dump({ limit: 64 * 1024 }).catch(() => {});
    const status = response.statusCode;
    if (status >= 200 && status < 300) return { ok: true };
    // A 4xx means the address is wrong or revoked; only "too many" and "timeout" are worth retrying.
    const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
    return { ok: false, permanent, error: `The receiver answered ${status}.` };
  } catch (error) {
    // A private address is a wrong address, not a bad moment: no point retrying.
    if (codeIn(error, 'blocked-address')) {
      return { ok: false, permanent: true, error: 'That address is inside a private network.' };
    }
    return { ok: false, permanent: false, error: (error as Error).message };
  } finally {
    await agent.close().catch(() => {});
  }
}
