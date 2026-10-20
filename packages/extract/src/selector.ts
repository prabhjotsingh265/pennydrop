import type { CheerioAPI } from 'cheerio';
import { isTag, type Element } from 'domhandler';

/**
 * Class names and ids that a build tool made up rather than a person: they
 * change on every deploy, so a selector built on them breaks next week.
 */
export function looksGenerated(token: string): boolean {
  if (/^(css|sc|jsx|emotion|styled|tw|chakra|mui|svelte)-/i.test(token)) return true;
  // Letters and digits mixed together ("a8k2x9"), unless it reads like "col-12" or "mt-5".
  return /\d/.test(token) && /[a-z]/i.test(token) && !/^[a-z]+(-[a-z]+)*-\d{1,3}$/i.test(token);
}

function escape(identifier: string): string {
  return identifier.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

// Attributes that people put there on purpose, in order of preference.
const HOOKS = [
  'data-price',
  'itemprop',
  'data-testid',
  'data-test',
  'data-qa',
  'data-cy',
  'name',
  'aria-label',
];

/** The ways to point at this element on its own, best first. */
function ownSelectors(element: Element): string[] {
  const out: string[] = [];
  const { id, class: classes = '' } = element.attribs;
  if (id && !looksGenerated(id)) out.push(`#${escape(id)}`);

  const attrs = Object.keys(element.attribs);
  const hooks = [...HOOKS, ...attrs.filter((a) => a.startsWith('data-') && a.includes('price'))];
  for (const name of hooks) {
    const value = element.attribs[name];
    if (value === undefined) continue;
    out.push(value === '' ? `[${name}]` : `[${name}=${quote(value)}]`);
  }

  const stable = classes.split(/\s+/).filter((c) => c && !looksGenerated(c));
  for (const name of stable) out.push(`.${escape(name)}`);
  for (const name of stable) out.push(`${element.name}.${escape(name)}`);
  if (stable.length > 1) out.push(`${element.name}${stable.map((c) => `.${escape(c)}`).join('')}`);
  return out;
}

function unique($: CheerioAPI, selector: string, element: Element): boolean {
  try {
    const matches = $(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/** The element's own tag and stable classes, plus its position among its siblings if needed. */
function step($: CheerioAPI, element: Element): string {
  const stable = (element.attribs.class ?? '').split(/\s+/).filter((c) => c && !looksGenerated(c));
  const base = element.name + stable.map((c) => `.${escape(c)}`).join('');
  const parent = element.parent;
  if (!parent || !isTag(parent)) return base;
  const same = $(parent).children(element.name).toArray();
  return same.length > 1 ? `${element.name}:nth-of-type(${same.indexOf(element) + 1})` : base;
}

/**
 * A CSS selector that matches this element and nothing else, built from the
 * most stable hooks the page offers. Falls back to a short path from the
 * nearest ancestor that can be pointed at on its own.
 */
export function selectorFor($: CheerioAPI, element: Element): string {
  for (const selector of ownSelectors(element)) {
    if (unique($, selector, element)) return selector;
  }

  // Climb until an ancestor can be named on its own, and anchor the path there:
  // a bare "div:nth-of-type(1) > span" breaks as soon as anything moves.
  const path = [step($, element)];
  let node = element.parent;
  while (node && isTag(node) && node.name !== 'html') {
    const landmark = ['main', 'article', 'body'].includes(node.name) && $(node.name).length === 1;
    const anchor =
      ownSelectors(node).find((s) => $(s).length === 1) ?? (landmark ? node.name : undefined);
    if (anchor) {
      const candidate = `${anchor} > ${path.join(' > ')}`;
      if (unique($, candidate, element)) return candidate;
    }
    path.unshift(step($, node));
    node = node.parent;
  }
  return path.join(' > ');
}
