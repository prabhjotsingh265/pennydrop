import type { ChannelInput, ChannelKind } from '@pennydrop/domain';
import { newSigningSecret } from './crypto.ts';

/** What a channel keeps, sealed in the database. */
export type ChannelSettings =
  | { kind: 'email'; address: string }
  | { kind: 'slack' | 'discord'; url: string }
  | { kind: 'webhook'; url: string; secret: string };

const PATTERNS: Partial<Record<ChannelKind, { test: RegExp; error: string }>> = {
  slack: {
    test: /^https:\/\/hooks\.slack\.com\/services\/[\w/-]+$/,
    error: 'A Slack incoming webhook starts with https://hooks.slack.com/services/.',
  },
  discord: {
    test: /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/,
    error: 'A Discord webhook starts with https://discord.com/api/webhooks/.',
  },
};

/** Locally, the practice shop's catcher stands in for Slack, Discord and any webhook. */
const isLocal = (url: URL) => url.hostname.endsWith('.localhost');

/**
 * Checks where a new channel would send, and what it keeps. Slack and Discord
 * addresses must be theirs; any other webhook must be HTTPS. Private networks
 * are refused again when a message is sent, after every DNS lookup.
 */
export function settingsFor(
  input: ChannelInput,
  { local }: { local: boolean },
): { ok: true; settings: ChannelSettings } | { ok: false; error: string } {
  if (input.kind === 'email')
    return { ok: true, settings: { kind: 'email', address: input.address } };
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false, error: 'That doesn’t look like a web address.' };
  }
  const localOk = local && isLocal(url) && (url.protocol === 'http:' || url.protocol === 'https:');
  const pattern = PATTERNS[input.kind];
  if (!localOk) {
    if (pattern && !pattern.test.test(url.toString())) return { ok: false, error: pattern.error };
    if (url.protocol !== 'https:') return { ok: false, error: 'Webhooks must use https://.' };
    if (url.username || url.password)
      return { ok: false, error: 'Leave the username and password out.' };
  }
  return input.kind === 'webhook'
    ? { ok: true, settings: { kind: 'webhook', url: url.toString(), secret: newSigningSecret() } }
    : { ok: true, settings: { kind: input.kind, url: url.toString() } };
}

/** Enough of a channel's address to recognise it, never enough to use it. */
export function hintFor(settings: ChannelSettings): string {
  if (settings.kind === 'email') return settings.address;
  const url = new URL(settings.url);
  const end = url.pathname.replace(/\/$/, '').slice(-4);
  return `${url.host}/…/${end}`;
}
