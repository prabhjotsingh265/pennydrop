import type { WatchSummary } from '@pennydrop/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useReducedMotion } from '../../lib/motion.ts';
import { firstChoice } from '../../lib/picker.ts';
import { keys, usePreview } from '../../lib/queries.ts';
import { Button } from '../../ui/Button.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PreviewProgress } from '../add/PreviewProgress.tsx';
import { ChoiceList, ScreenshotFrame } from '../add/ScreenshotPicker.tsx';

/** Opens a fresh preview of a watched product, so its price can be picked again. */
export async function startRepick(watch: WatchSummary): Promise<string> {
  const { id } = await api<{ id: string }>('/api/previews', {
    method: 'POST',
    body: { url: watch.url, repick: true },
  });
  return id;
}

/** The page as it is now, every price boxed: click the product's own, and it's read that way. */
export function RepickPanel({
  watch,
  previewId,
  onDone,
  onCancel,
}: {
  watch: WatchSummary;
  previewId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const view = usePreview(previewId);
  const result = view.data?.result ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choice = picked ?? (result ? firstChoice(result.choices) : null);
  const panel = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  // Opened from the foot of the page, it appears near the top: bring it into view.
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [reduced]);

  const save = async () => {
    if (choice === null) return;
    setSaving(true);
    setProblem(null);
    try {
      await api(`/api/watches/${watch.id}/pick`, {
        method: 'POST',
        body: { preview: { id: previewId, choice } },
      });
      await queryClient.invalidateQueries({ queryKey: keys.watch(watch.id) });
      await queryClient.invalidateQueries({ queryKey: keys.watches, exact: true });
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Not saved.');
      setSaving(false);
    }
  };

  let body;
  if (view.isError || view.data?.status === 'failed') {
    body = <Notice tone="error">The preview failed. Please try again in a moment.</Notice>;
  } else if (!result) {
    body = <PreviewProgress view={view.data} host={watch.host} />;
  } else if (!result.screenshot || result.choices.length === 0) {
    body = <Notice tone="error">{result.detail}</Notice>;
  } else {
    const shown = { ...result, screenshot: result.screenshot };
    body = (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ScreenshotFrame
          previewId={previewId}
          result={shown}
          choice={choice}
          onChoose={setPicked}
        />
        <div className="space-y-6">
          <ChoiceList result={shown} choice={choice} onChoose={setPicked} />
          {problem && <Notice tone="error">{problem}</Notice>}
          <div className="flex gap-3">
            <Button
              variant="primary"
              busy={saving}
              disabled={choice === null}
              onClick={() => void save()}
            >
              Use this price
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      ref={panel}
      aria-labelledby="repick"
      className="scroll-mt-24 rounded-[14px] border border-copper/50 p-5"
    >
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 id="repick" className="text-[15px] font-semibold">
          Which price is this product’s?
        </h2>
        {!result?.choices.length && (
          <button type="button" onClick={onCancel} className="text-sm text-ink-2 underline">
            Close
          </button>
        )}
      </div>
      {body}
    </section>
  );
}
