import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { isTag, isText, type AnyNode, type Element } from 'domhandler';
import { findPrices, type PriceHints } from './parse.ts';

export interface Page {
  $: CheerioAPI;
  /** The product's name on the page: the h1, or the nearest thing to one. */
  title: Element | null;
  buyButtons: Element[];
}

const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'head',
  'title',
  'iframe',
  'select',
  'option',
]);
const BUY = /\b(add to (basket|bag|cart|trolley)|buy now|add to order)\b/i;

export function loadPage(html: string): Page {
  const $ = cheerio.load(html);
  const title =
    $('h1').first()[0] ??
    $('[itemprop="name"]').first()[0] ??
    $('main [class*="title"], [class*="product-title"]').first()[0] ??
    $('h2, h3').first()[0] ??
    null;
  const buyButtons = $('button, a, input[type="submit"]')
    .filter((_, el) => BUY.test($(el).text() || $(el).attr('value') || ''))
    .toArray();
  return { $, title, buyButtons };
}

export interface TextNode {
  text: string;
  element: Element;
}

/** Every piece of text in the body, with the element that holds it. */
export function textNodes(page: Page): TextNode[] {
  const out: TextNode[] = [];
  const walk = (node: AnyNode) => {
    if (isText(node)) {
      if (node.data.trim() && node.parent && isTag(node.parent)) {
        out.push({ text: node.data, element: node.parent });
      }
      return;
    }
    if (!isTag(node) && node.type !== 'root') return;
    if (isTag(node) && SKIP.has(node.name)) return;
    for (const child of (node as Element).children ?? []) walk(child);
  };
  const body = page.$('body')[0] ?? page.$.root()[0];
  if (body) walk(body);
  return out;
}

export function ancestors(element: Element): Element[] {
  const chain: Element[] = [];
  let node: AnyNode | null = element;
  while (node && isTag(node)) {
    chain.push(node);
    node = node.parent;
  }
  return chain;
}

/** Steps up from each to their closest shared ancestor, added together. */
export function distance(a: Element, b: Element): number {
  const up = ancestors(a);
  const theirs = ancestors(b);
  for (let i = 0; i < up.length; i++) {
    const j = theirs.indexOf(up[i]!);
    if (j !== -1) return i + j;
  }
  return Infinity;
}

/** An element's class, id, itemprop and data-* attributes as words, lower case. */
export function attributeWords(element: Element): string[] {
  const attrs = element.attribs ?? {};
  const parts = [attrs.class, attrs.id, attrs.itemprop];
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('data-')) parts.push(name.slice(5), value);
  }
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const RELATED_WORDS =
  /^(related|recommended|recommendations?|similar|upsell|crosssell|recently|alsolike|carousel)$/;
const RELATED_HEADING =
  /\b(you (might|may) also like|related|similar|recommended|customers also|recently viewed|more from)\b/i;

/** Inside a "you might also like" kind of section, where prices belong to other products. */
export function isRelated(page: Page, element: Element): boolean {
  for (const node of ancestors(element)) {
    const words = attributeWords(node);
    if (words.some((w) => RELATED_WORDS.test(w)) || words.join('').includes('alsolike'))
      return true;
    if (['section', 'aside'].includes(node.name)) {
      const heading = page.$(node).find('h2, h3, h4').first().text();
      if (RELATED_HEADING.test(heading)) return true;
    }
  }
  return false;
}

/** In the site's header, footer or navigation, where prices are offers, not this product. */
export function isChrome(element: Element): boolean {
  return ancestors(element).some(
    (node) =>
      ['header', 'footer', 'nav'].includes(node.name) ||
      ['banner', 'contentinfo', 'navigation'].includes(node.attribs.role ?? ''),
  );
}

const WAS_WORDS = new Set([
  'was',
  'old',
  'compare',
  'rrp',
  'msrp',
  'strike',
  'strikethrough',
  'full',
  'original',
  'regular',
  'before',
  'list',
]);

/** A crossed-out or "was" price: the old price, not the current one. */
export function isWasPrice(element: Element): boolean {
  return ancestors(element)
    .slice(0, 3)
    .some((node) => {
      if (['s', 'del', 'strike'].includes(node.name)) return true;
      const words = attributeWords(node);
      return words.some((w) => w.includes('price')) && words.some((w) => WAS_WORDS.has(w));
    });
}

/** Marked up as a price: a class, id or data attribute that says so. */
export function isMarkedPrice(element: Element): boolean {
  return ancestors(element)
    .slice(0, 3)
    .some((node) => attributeWords(node).some((w) => w.includes('price') || w === 'amount'));
}

/** How a price-shaped piece of text looked in a real browser. */
export interface LayoutBox {
  /** Child positions from <html> down to the element. */
  path: number[];
  fontSize: number;
  /** Distance from the top of the page, in pixels. */
  y: number;
  visible: boolean;
  /** Crossed out, by markup or by CSS. */
  struck: boolean;
}

/** The first element a CSS selector finds. */
export function firstElement(page: Page, selector: string): Element | null {
  return page.$(selector).toArray().find(isTag) ?? null;
}

/** The element at a path from pathOf, or from a browser's box. */
export function elementAt(page: Page, path: readonly number[]): Element | null {
  let node: Element | undefined = page.$('html')[0];
  for (const index of path) node = node?.children.filter(isTag)[index];
  return node ?? null;
}

/** The element's child positions from <html> down: how a browser box finds it again. */
export function pathOf(element: Element): number[] {
  const path: number[] = [];
  let node: Element = element;
  while (node.parent && isTag(node.parent)) {
    const siblings = node.parent.children.filter(isTag);
    path.unshift(siblings.indexOf(node));
    node = node.parent;
  }
  return path;
}

/** This many prices in elements built alike, with nowhere to buy, make a page of products. */
const LISTING_MIN = 4;

/**
 * A category or home page: a grid of products, each with its price, and no
 * buy button. Its prices belong to many products, so none of them is "the"
 * price. A product page keeps its buy button even when related products
 * are listed below it.
 */
export function looksLikeListing(page: Page, hints: PriceHints = {}): boolean {
  if (page.buyButtons.length > 0) return false;
  const shapes = new Map<string, number>();
  for (const { text, element } of textNodes(page)) {
    if (!findPrices(text, hints).length) continue;
    const classes = (element.attribs.class ?? '').trim().split(/\s+/).sort().join('.');
    const shape = `${element.name}.${classes}`;
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  return Math.max(0, ...shapes.values()) >= LISTING_MIN;
}
