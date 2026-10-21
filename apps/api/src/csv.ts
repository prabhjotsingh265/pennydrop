/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starting with
 * =, +, -, @ or a tab) gets a leading apostrophe: product names are typed by
 * people, and a file opened in Excel must never run them.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A file name from a product's name: "Oak serving board" becomes "oak-serving-board". */
export function fileName(label: string): string {
  return (
    label
      .toLowerCase()
      // "é" comes apart into "e" and an accent; the accent goes.
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'product'
  );
}
