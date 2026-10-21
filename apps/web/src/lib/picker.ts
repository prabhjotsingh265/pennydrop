import type { PreviewChoice } from '@pennydrop/domain';

/**
 * A price on the screenshot in words, for anyone not using the picture:
 * "the largest, near the top", "small, near the bottom, crossed out".
 */
export function describeChoice(
  choice: PreviewChoice,
  all: readonly PreviewChoice[],
  pageHeight: number,
): string {
  const parts: string[] = [];
  const tallest = Math.max(...all.map((c) => c.height));
  if (all.length > 1 && choice.height === tallest) parts.push('the largest');
  else if (choice.height < tallest * 0.6) parts.push('small');
  const down = (choice.y + choice.height / 2) / pageHeight;
  parts.push(down < 1 / 3 ? 'near the top' : down < 2 / 3 ? 'halfway down' : 'near the bottom');
  if (choice.struck) parts.push('crossed out, so a “was” price');
  return parts.join(', ');
}

/** The choice to start on: the automatic pick, if there is one. */
export function firstChoice(choices: readonly PreviewChoice[]): number | null {
  const best = choices.findIndex((c) => c.best);
  return best < 0 ? null : best;
}
