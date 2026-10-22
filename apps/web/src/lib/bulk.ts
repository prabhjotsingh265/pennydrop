import { BULK_MAX, minorUnitsFrom } from '@pennydrop/domain';

export interface BulkLine {
  /** The line in what was pasted, counting from 1, for pointing at problems. */
  line: number;
  url: string;
  targetPrice?: number;
  label?: string;
}

export interface ParsedBulk {
  items: BulkLine[];
  problems: { line: number; error: string }[];
  tooMany: boolean;
}

/** One CSV row: commas split cells, quotes keep commas in, "" is a quote. */
export function csvRow(row: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i]!;
    if (quoted) {
      if (char === '"' && row[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

const HEADERS = {
  url: ['address', 'url', 'link'],
  target: ['target', 'target price', 'target_price'],
  label: ['label', 'name'],
} as const;

/**
 * What was pasted or uploaded, as products to add: one address per line, or a
 * CSV with the columns address, target and label (named in a header row, or
 * in that order in a file without one). Targets are read with two decimals.
 */
export function parseBulk(text: string, fromFile = false): ParsedBulk {
  const lines = text
    .split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(({ raw }) => raw && !raw.startsWith('#'));
  const first = lines[0] ? csvRow(lines[0].raw).map((cell) => cell.toLowerCase()) : [];
  const header = first.some((cell) => (HEADERS.url as readonly string[]).includes(cell));
  const csv = header || fromFile;
  const column = (names: readonly string[], fallback: number) => {
    const found = first.findIndex((cell) => names.includes(cell));
    return header ? found : fallback;
  };
  const at = {
    url: column(HEADERS.url, 0),
    target: column(HEADERS.target, 1),
    label: column(HEADERS.label, 2),
  };

  const items: BulkLine[] = [];
  const problems: ParsedBulk['problems'] = [];
  for (const { raw, line } of header ? lines.slice(1) : lines) {
    const cells = csv ? csvRow(raw) : [raw];
    const url = cells[at.url]?.trim() ?? '';
    if (!url) {
      problems.push({ line, error: 'No address on this line.' });
      continue;
    }
    const item: BulkLine = { line, url };
    const target = at.target >= 0 ? cells[at.target]?.trim() : undefined;
    if (target) {
      const minor = minorUnitsFrom(target, 'GBP');
      if (minor === null) {
        problems.push({ line, error: `“${target}” doesn’t look like a price.` });
        continue;
      }
      item.targetPrice = minor;
    }
    const label = at.label >= 0 ? cells[at.label]?.trim() : undefined;
    if (label) item.label = label.slice(0, 120);
    items.push(item);
  }
  return { items, problems, tooMany: items.length > BULK_MAX };
}
