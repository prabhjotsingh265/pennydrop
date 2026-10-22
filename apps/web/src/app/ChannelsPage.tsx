import { CHANNEL_KINDS, type ChannelKind, type ChannelSummary } from '@pennydrop/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Send, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CHANNEL_HELP, KIND_LABELS } from '../lib/alerts.ts';
import { ApiError, api } from '../lib/api.ts';
import { keys, useChannels, useMe } from '../lib/queries.ts';
import { ago, useNow } from '../lib/time.ts';
import { Button } from '../ui/Button.tsx';
import { ChannelIcon } from '../ui/ChannelIcon.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';

function useRefreshChannels() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.channels });
}

function ChannelCard({ channel, now }: { channel: ChannelSummary; now: number }) {
  const refresh = useRefreshChannels();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(channel.name);
  const [confirming, setConfirming] = useState(false);
  const broken = channel.status === 'broken';

  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; error?: string }>(`/api/channels/${channel.id}/test`, { method: 'POST' }),
    onSuccess: (answer) =>
      setResult(
        answer.ok
          ? {
              ok: true,
              text: `Sent. Look for “A test from Pennydrop” in ${KIND_LABELS[channel.kind]}.`,
            }
          : { ok: false, text: answer.error ?? 'It didn’t arrive.' },
      ),
    onError: (error) => setResult({ ok: false, text: error.message }),
    onSettled: refresh,
  });
  const rename = useMutation({
    mutationFn: () =>
      api(`/api/channels/${channel.id}`, { method: 'PATCH', body: { name: name.trim() } }),
    onSuccess: () => {
      setRenaming(false);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/channels/${channel.id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <li
      className={`rounded-[14px] border p-4 sm:p-5 ${broken ? 'border-danger/50' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-surface text-ink-2">
            <ChannelIcon kind={channel.kind} />
          </span>
          <div className="min-w-0">
            {renaming ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (name.trim()) rename.mutate();
                }}
              >
                <label htmlFor={`name-${channel.id}`} className="sr-only">
                  Name
                </label>
                <input
                  id={`name-${channel.id}`}
                  value={name}
                  maxLength={60}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  className="h-9 rounded-[8px] border border-line bg-paper px-2.5 text-[15px] outline-none focus:border-copper-deep"
                />
                <Button type="submit" busy={rename.isPending} className="h-9">
                  Save
                </Button>
                <button
                  type="button"
                  className="text-sm text-ink-2 hover:text-ink"
                  onClick={() => {
                    setName(channel.name);
                    setRenaming(false);
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <h2 className="truncate text-[15px] font-semibold">{channel.name}</h2>
            )}
            <p className="tabular mt-0.5 truncate text-[12px] text-ink-2">
              {KIND_LABELS[channel.kind]} · {channel.hint}
            </p>
            <p className="mt-1.5 text-[13px] text-ink-2">
              {broken ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-danger">
                  <TriangleAlert size={14} aria-hidden="true" /> Stopped
                </span>
              ) : channel.lastSentAt ? (
                `Working: last sent ${ago(Math.max(now - Date.parse(channel.lastSentAt), 0))}`
              ) : (
                'Nothing sent yet'
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button busy={test.isPending} onClick={() => test.mutate()}>
            <Send size={15} aria-hidden="true" /> Send a test
          </Button>
          {!renaming && (
            <Button onClick={() => setRenaming(true)} aria-label={`Rename ${channel.name}`}>
              Rename
            </Button>
          )}
        </div>
      </div>

      {broken && (
        <p className="mt-4 text-sm">
          Three deliveries in a row failed, so alerts to it are paused. The last answer was:{' '}
          <span className="text-danger">{channel.lastError ?? 'unknown'}</span>. Once it’s fixed at
          the other end, send a test to switch it back on. If the address itself changed, remove
          this channel and add the new one.
        </p>
      )}
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`mt-3 text-sm ${result.ok ? 'text-verdigris-deep' : 'text-danger'}`}
        >
          {result.text}
        </p>
      )}

      <div className="mt-4 border-t border-line pt-3 text-sm">
        {confirming ? (
          <span className="flex flex-wrap items-center gap-3">
            Remove “{channel.name}”? Alerts stop going there.
            <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
              Remove
            </Button>
            <button
              type="button"
              className="text-ink-2 hover:text-ink"
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="text-ink-2 hover:text-danger"
            onClick={() => setConfirming(true)}
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/** Shown once, just after a webhook is added: the secret its receiver checks signatures with. */
function SigningSecret({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // It appears where the form was, and says so to a screen reader: missing it means losing it.
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <section
      aria-labelledby="secret"
      className="space-y-3 rounded-[14px] border border-copper/50 bg-copper/5 p-4 sm:p-5"
    >
      <h2
        id="secret"
        ref={heading}
        tabIndex={-1}
        className="text-[15px] font-semibold focus:outline-none"
      >
        Your webhook’s signing secret
      </h2>
      <p className="text-sm">Copy it now: it won’t be shown again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="tabular min-w-0 rounded-[8px] border border-line bg-paper px-3 py-2 text-[13px] break-all">
          {secret}
        </code>
        <Button
          onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="space-y-1.5 text-[13px] text-ink-2">
        <p>
          Each request carries{' '}
          <code className="tabular text-ink">Pennydrop-Signature: t=…,v1=…</code>, where v1 is the
          HMAC-SHA256 of <code className="tabular text-ink">t.body</code> (the time, a full stop,
          then the raw body) under this secret, in hex.
        </p>
        <p>Reject a request whose signature doesn’t match, or whose time is over 5 minutes old.</p>
        <p>
          <code className="tabular text-ink">Pennydrop-Delivery</code> stays the same when one alert
          is retried, so you can ignore repeats.
        </p>
      </div>
      <Button variant="primary" onClick={onDone}>
        I’ve saved it
      </Button>
    </section>
  );
}

interface Values {
  name: string;
  address: string;
}

function AddChannel() {
  const refresh = useRefreshChannels();
  const [kind, setKind] = useState<ChannelKind>('slack');
  const [added, setAdded] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const form = useForm<Values>({ defaultValues: { name: '', address: '' } });
  const { errors, isSubmitting } = form.formState;
  const help = CHANNEL_HELP[kind];

  const onSubmit = form.handleSubmit(async (values) => {
    setAdded(null);
    const name = values.name.trim() || KIND_LABELS[kind];
    const address = values.address.trim();
    if (!address) {
      form.setError('address', { message: `Paste the ${help.label.toLowerCase()} here.` });
      return;
    }
    try {
      const answer = await api<{ channel: ChannelSummary; secret?: string }>('/api/channels', {
        method: 'POST',
        body: kind === 'email' ? { kind, name, address } : { kind, name, url: address },
      });
      form.reset();
      setAdded(answer.channel.name);
      if (answer.secret) setSecret(answer.secret);
      await refresh();
    } catch (error) {
      const issue = error instanceof ApiError ? error.issues[0] : undefined;
      const message = issue?.message ?? (error instanceof Error ? error.message : 'Not added.');
      if (error instanceof ApiError && (error.field === 'url' || issue)) {
        form.setError('address', { message });
      } else {
        form.setError('root', { message });
      }
    }
  });

  return (
    <section aria-labelledby="add-channel" className="max-w-xl space-y-5">
      <h2 id="add-channel" className="text-[15px] font-semibold">
        Add a channel
      </h2>
      <div
        role="radiogroup"
        aria-label="Kind of channel"
        className="flex flex-wrap rounded-[8px] border border-line p-0.5"
      >
        {CHANNEL_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              form.clearErrors();
            }}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-3 py-2 text-sm transition ${
              kind === k ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
            }`}
          >
            <ChannelIcon kind={k} size={15} />
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {errors.root && <Notice tone="error">{errors.root.message}</Notice>}
        {secret ? (
          <SigningSecret secret={secret} onDone={() => setSecret(null)} />
        ) : (
          added && <Notice>Added “{added}”. Send it a test to be sure it arrives.</Notice>
        )}
        <Field
          label={help.label}
          type={help.type}
          placeholder={help.placeholder}
          hint={help.hint}
          autoComplete="off"
          spellCheck={false}
          error={errors.address?.message}
          {...form.register('address')}
        />
        <Field
          label="Name"
          placeholder={KIND_LABELS[kind]}
          maxLength={60}
          hint="So you can tell your channels apart, such as “Team Slack”."
          error={errors.name?.message}
          {...form.register('name')}
        />
        <Button type="submit" variant="primary" busy={isSubmitting}>
          Add channel
        </Button>
      </form>
    </section>
  );
}

/** Where alerts go: each alert goes to every channel here. */
export function ChannelsPage() {
  const channels = useChannels();
  const me = useMe().data!;
  const now = useNow();

  return (
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">
          Alert channels
        </h1>
        <p className="mt-2 max-w-[60ch] text-sm text-ink-2">
          Every alert in {me.workspace.name} goes to each channel here. Addresses are stored
          encrypted, and only enough of each is shown to recognise it.
        </p>
      </div>

      {channels.isPending ? (
        <div className="h-[160px] animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      ) : channels.isError ? (
        <Notice tone="error">{channels.error.message}</Notice>
      ) : channels.data.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-line p-6 text-sm text-ink-2">
          No channels yet, so alerts only reach your inbox here. Add one below.
        </p>
      ) : (
        <ul className="space-y-3">
          {channels.data.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} now={now} />
          ))}
        </ul>
      )}

      <AddChannel />
    </div>
  );
}
