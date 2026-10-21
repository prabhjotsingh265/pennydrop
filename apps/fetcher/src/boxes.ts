/** Where a price-shaped piece of text sits on the rendered page. */
export interface PriceBox {
  text: string;
  /** Child positions from <html> down to the element, to find it again in the saved HTML. */
  path: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  visible: boolean;
  /** Crossed out, by markup or by CSS: a "was" price. */
  struck: boolean;
}

/**
 * Runs inside the page. Kept as a plain string: test runners can add helper
 * calls to compiled functions, and those helpers don't exist in the browser.
 */
export const PRICE_BOXES_SCRIPT = String.raw`(() => {
  const PRICE = /(?:[£€$¥₹₩₺₫฿₱₪￥]|US\$|\b[A-Z]{3}\b|\bkr\.?|zł|\bRs\.?)\s?\d|\d[\d.,'’\s\u00a0\u202f]*\s?(?:[£€$¥₹￥]|kr|zł|\b[A-Z]{3}\b)/;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
  const pathOf = (element) => {
    const path = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
    }
    return path;
  };
  const boxes = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || SKIP.has(element.tagName) || seen.has(element)) continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 120 || !PRICE.test(text)) continue;
    seen.add(element);
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    boxes.push({
      text,
      path: pathOf(element),
      x: rect.left + scrollX,
      y: rect.top + scrollY,
      width: rect.width,
      height: rect.height,
      fontSize: parseFloat(style.fontSize) || 0,
      fontWeight: Number(style.fontWeight) || 400,
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0,
      struck: /line-through/.test(style.textDecorationLine) || Boolean(element.closest('s, del, strike')),
    });
  }
  return boxes;
})()`;
