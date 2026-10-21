/** A price on the preview's screenshot that someone can click. */
export interface PreviewChoice {
  text: string;
  amount: number;
  currency: string | null;
  /** Where it sits on the screenshot, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Crossed out: a "was" price. */
  struck: boolean;
  /** The automatic pick. */
  best: boolean;
}

/** A finished preview, as the person adding the product sees it. */
export interface PreviewShown {
  /** "ok", or why the page couldn't be read: "robots_disallowed", "timeout", … */
  outcome: string;
  /** In words, for the person waiting. */
  detail: string;
  /** Where the page ended up, after any redirects. */
  url: string;
  title: string | null;
  amount: number | null;
  currency: string | null;
  was: number | null;
  inStock: boolean | null;
  choices: PreviewChoice[];
  /** The page as served already holds the price, so checks can skip the browser. */
  plainHtmlWorks: boolean | null;
  screenshot: { width: number; height: number } | null;
  timings: Record<string, number>;
}

export type PreviewStatus = 'waiting' | 'working' | 'done' | 'failed';

/** What GET /api/previews/:id answers while someone waits. */
export interface PreviewView {
  status: PreviewStatus;
  /** "waiting" for the shop's turn, or "opening" the page. */
  step: string | null;
  result: PreviewShown | null;
}
