import type { SystemView } from '@pennydrop/domain';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { useMe } from '../../lib/queries.ts';
import { compact, lagWords } from '../../lib/system.ts';
import { dateWords } from '../../lib/time.ts';
import { useTitle } from '../../lib/title.ts';
import { Button } from '../../ui/Button.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Lanes } from './Lanes.tsx';
import { Throughput } from './Throughput.tsx';

/** A headline number: its label, the value in plain figures, and a line of context. */
function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[14px] border border-line p-4">
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className="mt-1 text-[28px] leading-tight font-semibold">{value}</div>
      <div className="mt-0.5 text-[12px] text-ink-2">{note}</div>
    </div>
  );
}

function tiles(view: SystemView) {
  const lastTen = view.throughput.filter(
    (row) => Date.parse(row.minute) > Date.parse(view.at) - 10 * 60_000,
  );
  const perMinute = lastTen.reduce((sum, row) => sum + row.read + row.notRead, 0) / 10;
  const read = view.throughput.reduce((sum, row) => sum + row.read, 0);
  const all = view.throughput.reduce((sum, row) => sum + row.read + row.notRead, 0);
  const waiting = view.queues
    .filter((queue) => queue.name.startsWith('fetch'))
    .reduce((sum, queue) => sum + queue.waiting + queue.delayed, 0);
  return [
    {
      label: 'Checks a minute',
      value: perMinute < 10 ? perMinute.toFixed(1) : compact(Math.round(perMinute)),
      note: 'over the last 10 minutes',
    },
    {
      label: 'Read the page',
      value: all ? `${Math.round((read / all) * 100)}%` : '—',
      note: `of ${compact(all)} checks in the last hour`,
    },
    {
      label: 'Waiting to be fetched',
      value: compact(waiting),
      note: 'queued or put back for their site',
    },
    {
      label: 'Schedule',
      value: lagWords(view.due.lagMs),
      note: `${compact(view.due.count)} products due now`,
    },
  ];
}

/** The platform at a glance, for its admins: the lanes, throughput, queues, sites, failures, the demo. */
export function SystemPage() {
  useTitle('System · Pennydrop');
  const me = useMe().data!;
  const words = dateWords(me.workspace.timezone);
  const system = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: ({ signal }) => api<SystemView>('/api/admin/system', { signal }),
    refetchInterval: 10_000,
  });
  const [chores, setChores] = useState<'idle' | 'busy' | 'queued' | string>('idle');

  const runChores = async () => {
    setChores('busy');
    try {
      await api('/api/admin/maintenance', { method: 'POST' });
      setChores('queued');
    } catch (error) {
      setChores(error instanceof Error ? error.message : 'Not queued.');
    }
  };

  if (system.isError) {
    return (
      <Notice tone="error">
        {system.error instanceof ApiError && system.error.status === 404
          ? 'This page is for Pennydrop’s admins.'
          : system.error.message}
      </Notice>
    );
  }

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold [font-stretch:108%]">System</h1>
        <p className="mt-2 text-sm text-ink-2">
          Every site, queue and worker, live. Refreshed every few seconds.
        </p>
      </div>

      {system.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles(system.data).map((tile) => (
            <Tile key={tile.label} {...tile} />
          ))}
        </div>
      ) : (
        <div className="h-[104px] animate-pulse rounded-[14px] bg-surface" aria-busy="true" />
      )}

      <Lanes time={words.time} />

      {system.data && (
        <>
          <Throughput rows={system.data.throughput} at={system.data.at} time={words.time} />

          <div className="grid gap-12 lg:grid-cols-2">
            <section aria-labelledby="queues" className="min-w-0">
              <h2 id="queues" className="text-[15px] font-semibold">
                Queues
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="tabular w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-ink-2">
                      <th className="py-1.5 font-normal">Queue</th>
                      <th className="py-1.5 text-right font-normal">Waiting</th>
                      <th className="py-1.5 text-right font-normal">Running</th>
                      <th className="py-1.5 text-right font-normal">Later</th>
                      <th className="py-1.5 text-right font-normal">Failed</th>
                      <th className="py-1.5 text-right font-normal">Workers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {system.data.queues.map((queue) => (
                      <tr key={queue.name} className="border-t border-line">
                        <td className="py-1.5">{queue.name}</td>
                        <td className="py-1.5 text-right">{compact(queue.waiting)}</td>
                        <td className="py-1.5 text-right">{queue.active}</td>
                        <td className="py-1.5 text-right">{compact(queue.delayed)}</td>
                        <td className={`py-1.5 text-right ${queue.failed ? 'text-danger' : ''}`}>
                          {compact(queue.failed)}
                        </td>
                        <td className="py-1.5 text-right">{queue.workers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="sites" className="min-w-0">
              <h2 id="sites" className="text-[15px] font-semibold">
                Busiest sites, last hour
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="tabular w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-ink-2">
                      <th className="py-1.5 font-normal">Site</th>
                      <th className="py-1.5 text-right font-normal">Products</th>
                      <th className="py-1.5 text-right font-normal">Read</th>
                      <th className="py-1.5 text-right font-normal">Didn’t</th>
                      <th className="py-1.5 pl-3 font-normal">Breaker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {system.data.sites.map((site) => (
                      <tr key={site.host} className="border-t border-line">
                        <td className="max-w-[14rem] truncate py-1.5">{site.host}</td>
                        <td className="py-1.5 text-right">{site.products}</td>
                        <td className="py-1.5 text-right">{compact(site.read)}</td>
                        <td className={`py-1.5 text-right ${site.notRead ? 'text-danger' : ''}`}>
                          {compact(site.notRead)}
                        </td>
                        <td className="py-1.5 pl-3">
                          {site.breakerState === 'closed' ? (
                            <span className="inline-flex items-center gap-1 text-ink-2">
                              <ShieldCheck size={12} aria-hidden="true" /> closed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-danger">
                              <ShieldAlert size={12} aria-hidden="true" />{' '}
                              {site.breakerState.replace('_', '-')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="grid gap-12 lg:grid-cols-2">
            <section aria-labelledby="failed" className="min-w-0">
              <h2 id="failed" className="text-[15px] font-semibold">
                Recent failed jobs
              </h2>
              {system.data.failed.length === 0 ? (
                <p className="mt-3 text-sm text-ink-2">None kept.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line border-y border-line text-[12px]">
                  {system.data.failed.map((job) => (
                    <li key={`${job.queue}-${job.id}`} className="py-2">
                      <div className="tabular flex justify-between gap-3 text-ink-2">
                        <span className="truncate">
                          {job.queue} · {job.id}
                        </span>
                        {job.at && <span>{words.moment(Date.parse(job.at))}</span>}
                      </div>
                      <div className="mt-0.5 break-words">{job.reason}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="demo" className="min-w-0 space-y-3">
              <h2 id="demo" className="text-[15px] font-semibold">
                The demo
              </h2>
              <p className="text-sm">
                {system.data.demo.active} running, {system.data.demo.sandboxes} sandbox shops,{' '}
                {system.data.demo.visitors} visitors kept.
              </p>
              <p className="text-[13px] text-ink-2">
                Every night at 03:00 UTC, ended demos are deleted with their visitors and shops, and
                old checks and screenshots are pruned.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button busy={chores === 'busy'} onClick={() => void runChores()}>
                  Run the nightly clean-up now
                </Button>
                {chores === 'queued' && (
                  <span role="status" className="text-sm text-ink-2">
                    Queued: the worker runs it next.
                  </span>
                )}
                {!['idle', 'busy', 'queued'].includes(chores) && (
                  <span role="alert" className="text-sm text-danger">
                    {chores}
                  </span>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
