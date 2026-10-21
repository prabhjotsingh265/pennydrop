import type { PreviewShown } from '@pennydrop/domain';
import { useEffect, useRef } from 'react';
import { formatMoney } from '../../lib/money.ts';
import { describeChoice } from '../../lib/picker.ts';

const PAD = 6;
const pct = (value: number, of: number) => `${(value / of) * 100}%`;

type Shown = PreviewShown & { screenshot: { width: number; height: number } };

interface PickerProps {
  result: Shown;
  choice: number | null;
  onChoose: (index: number) => void;
}

/**
 * The page as Pennydrop saw it, with every price boxed. Click one to track
 * it, and a copper ring glides to it.
 */
export function ScreenshotFrame({
  previewId,
  result,
  choice,
  onChoose,
}: PickerProps & { previewId: string }) {
  const { width, height } = result.screenshot;
  const frame = useRef<HTMLDivElement>(null);
  const chosen = choice === null ? null : result.choices[choice];

  // Start with the automatic pick in view: on a long page it can be far down.
  const startAt = useRef(chosen);
  useEffect(() => {
    const element = frame.current;
    const box = startAt.current;
    if (!element || !box) return;
    const top = (box.y / height) * element.scrollHeight;
    element.scrollTo({ top: Math.max(0, top - element.clientHeight / 3) });
  }, [height]);

  return (
    <div
      ref={frame}
      className="max-h-[75vh] overflow-auto rounded-[14px] border border-line bg-surface"
    >
      <div className="relative" style={{ aspectRatio: `${width} / ${height}` }}>
        <img
          src={`/api/previews/${previewId}/screenshot`}
          alt=""
          className="absolute inset-0 size-full select-none"
          draggable={false}
        />
        {/* The list beside the picture is the way in for keyboards and screen readers. */}
        {result.choices.map((c, index) => (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => onChoose(index)}
            className={`absolute rounded-[6px] border-2 border-dashed transition hover:bg-copper/15 ${
              c.struck ? 'border-ink-2/60' : 'border-copper-deep/70'
            }`}
            style={{
              left: pct(c.x - PAD, width),
              top: pct(c.y - PAD, height),
              width: pct(c.width + PAD * 2, width),
              height: pct(c.height + PAD * 2, height),
            }}
          />
        ))}
        {chosen && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-[8px] bg-copper/15 ring-[3px] ring-copper transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{
              left: pct(chosen.x - PAD - 2, width),
              top: pct(chosen.y - PAD - 2, height),
              width: pct(chosen.width + PAD * 2 + 4, width),
              height: pct(chosen.height + PAD * 2 + 4, height),
            }}
          >
            {/* Kept inside the picture: on the right-hand side it hangs from the box's right edge. */}
            <span
              className={`tabular absolute -top-7 rounded-[6px] bg-copper px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-on-copper ${
                chosen.x > width / 2 ? 'right-0' : 'left-0'
              }`}
            >
              Tracking this
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The same prices as a list, described in words: the picker for keyboards and screen readers. */
export function ChoiceList({ result, choice, onChoose }: PickerProps) {
  const currency = result.currency ?? 'GBP';
  return (
    <fieldset>
      <legend className="text-sm font-medium">Which price should Pennydrop track?</legend>
      <p className="mt-1 text-[13px] text-ink-2">Click it on the screenshot, or choose it here.</p>
      <div className="mt-3 max-h-[40vh] space-y-2 overflow-auto pr-1">
        {result.choices.map((c, index) => (
          <label
            key={index}
            className={`flex cursor-pointer items-start gap-3 rounded-[8px] border px-3 py-2.5 transition ${
              choice === index ? 'border-copper bg-copper/10' : 'border-line hover:border-ink-2/40'
            }`}
          >
            <input
              type="radio"
              name="price"
              className="mt-1 accent-[var(--copper-deep)]"
              checked={choice === index}
              onChange={() => onChoose(index)}
            />
            <span className="min-w-0">
              <span className={`tabular text-[15px] ${c.struck ? 'line-through' : ''}`}>
                {formatMoney(c.amount, c.currency ?? currency)}
              </span>
              {c.best && (
                <span className="ml-2 text-[11px] font-medium text-copper-deep">our pick</span>
              )}
              <span className="block text-[12px] text-ink-2">
                {describeChoice(c, result.choices, result.screenshot.height)}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
