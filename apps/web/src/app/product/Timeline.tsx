import type { WatchEvent } from '@pennydrop/domain';
import { eventWords } from '../../lib/events.ts';
import { ago } from '../../lib/time.ts';

/** What happened to this product, and to its shop, newest first. */
export function Timeline({
  events,
  now,
  moment,
}: {
  events: WatchEvent[];
  now: number;
  moment: (t: number) => string;
}) {
  return (
    <section aria-labelledby="timeline">
      <h2 id="timeline" className="text-[15px] font-semibold">
        Timeline
      </h2>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">Nothing unusual so far.</p>
      ) : (
        <ol className="mt-4 space-y-4 border-l border-line pl-5">
          {events.map((event) => {
            const at = Date.parse(event.at);
            return (
              <li key={event.id} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-copper"
                />
                <p className="text-sm">{eventWords(event)}</p>
                <p className="tabular mt-0.5 text-[11px] text-ink-2">
                  <time dateTime={event.at} title={moment(at)}>
                    {ago(now - at)}
                  </time>
                  {event.siteWide && ' · the whole shop'}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
