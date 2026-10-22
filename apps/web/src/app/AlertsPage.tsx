import type { AlertSummary } from '@pennydrop/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DELIVERY_WORDS } from '../lib/alerts.ts';
import { api } from '../lib/api.ts';
import { formatMoney } from '../lib/money.ts';
import { keys, useAlerts, useMe } from '../lib/queries.ts';
import { ago, dateWords, useNow } from '../lib/time.ts';
import { Button } from '../ui/Button.tsx';
import { ChannelIcon } from '../ui/ChannelIcon.tsx';
import { Notice } from '../ui/Notice.tsx';

/** Alerts read this long before the page opened still count as new on it. */
const FRESH_MS = 60_000;

function AlertRow({
  alert,
  fresh,
  now,
  moment,
}: {
  alert: AlertSummary;
  fresh: boolean;
  now: number;
  moment: (t: number) => string;
}) {
  const currency = alert.currency ?? 'GBP';
  const firedAt = Date.parse(alert.firedAt);
  return (
    <li
      className={`grid gap-3 rounded-[14px] border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5 ${
        fresh ? 'border-copper/50 bg-copper/5' : 'border-line'
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {fresh && (
            <span
              className="size-2 shrink-0 self-center rounded-full bg-copper"
              aria-hidden="true"
            />
          )}
          <Link
            to={`/app/p/${alert.watchId}`}
            className="truncate text-[15px] font-semibold hover:underline"
          >
            {alert.label}
          </Link>
          <span className="tabular text-[15px]">
            {alert.price === null ? 'no price' : formatMoney(alert.price, currency)}
          </span>
          {alert.previousPrice !== null && alert.previousPrice !== alert.price && (
            <s className="tabular text-[13px] text-ink-2">
              {formatMoney(alert.previousPrice, currency)}
            </s>
          )}
          {fresh && <span className="sr-only">(new)</span>}
        </div>
        <p className="tabular mt-0.5 text-[12px] text-ink-2">{alert.host}</p>
        <ul className="mt-3 space-y-1 text-sm">
          {alert.reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span className="text-copper-deep" aria-hidden="true">
                •
              </span>
              {reason}
            </li>
          ))}
        </ul>
        {alert.verified && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-verdigris-deep">
            <ShieldCheck size={14} aria-hidden="true" /> Verified twice: a change this big is always
            checked again first
          </p>
        )}
        {alert.deliveries.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
            {alert.deliveries.map((delivery) => {
              const bad = delivery.status === 'failed' || delivery.status === 'skipped';
              return (
                <li
                  key={delivery.channel}
                  className={`inline-flex items-center gap-1.5 ${bad ? 'text-danger' : ''}`}
                >
                  <ChannelIcon kind={delivery.kind} size={13} />
                  {delivery.channel}: {DELIVERY_WORDS[delivery.status]}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <time
        dateTime={alert.firedAt}
        title={moment(firedAt)}
        className="tabular text-[12px] text-ink-2 sm:text-right"
      >
        {ago(Math.max(now - firedAt, 0))}
      </time>
    </li>
  );
}

/** Every alert, newest first. Opening it marks them read; this visit still shows which were new. */
export function AlertsPage() {
  const me = useMe().data!;
  const words = dateWords(me.workspace.timezone);
  const now = useNow();
  const alerts = useAlerts();
  const queryClient = useQueryClient();
  const [openedAt] = useState(() => Date.now());
  const list = alerts.data?.pages.flatMap((page) => page.alerts) ?? [];

  const { mutate: markRead } = useMutation({
    mutationFn: (ids: string[]) => api('/api/alerts/read', { method: 'POST', body: { ids } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.alerts }),
  });
  const unread = list
    .filter((alert) => alert.readAt === null)
    .map((alert) => alert.id)
    .join(',');
  useEffect(() => {
    if (unread) markRead(unread.split(','));
  }, [unread, markRead]);

  const fresh = (alert: AlertSummary) =>
    alert.readAt === null || Date.parse(alert.readAt) > openedAt - FRESH_MS;

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">Alerts</h1>
          <p className="mt-2 text-sm text-ink-2">
            Every time a price met one of your rules, and where we sent it.
          </p>
        </div>
        <Link to="/app/channels" className="text-sm text-copper-deep underline">
          Alert channels
        </Link>
      </div>

      {alerts.isPending ? (
        <div className="h-[240px] animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      ) : alerts.isError ? (
        <Notice tone="error">{alerts.error.message}</Notice>
      ) : list.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line p-8 text-sm text-ink-2">
          <p className="text-ink">No alerts yet.</p>
          <p className="mt-2 max-w-[56ch]">
            Turn on alerts on a product’s page. When its price meets one, the alert lands here and
            on each of your{' '}
            <Link to="/app/channels" className="text-copper-deep underline">
              channels
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {list.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                fresh={fresh(alert)}
                now={now}
                moment={words.moment}
              />
            ))}
          </ul>
          {alerts.hasNextPage && (
            <Button busy={alerts.isFetchingNextPage} onClick={() => void alerts.fetchNextPage()}>
              Show older alerts
            </Button>
          )}
        </>
      )}
    </div>
  );
}
