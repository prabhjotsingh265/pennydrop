const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Markup that has already been escaped, or that we wrote ourselves. */
export class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value: string) => new Html(value);

function render(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** A template tag that escapes every value unless it's already Html. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '');
  });
  return new Html(out);
}

/** JSON for a <script> tag: "<" is escaped so the data can't close the tag. */
export function scriptJson(data: unknown): Html {
  return raw(JSON.stringify(data).replace(/</g, '\\u003c'));
}
