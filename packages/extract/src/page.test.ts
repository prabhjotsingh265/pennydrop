import { describe, expect, it } from 'vitest';
import { elementAt, firstElement, loadPage, pathOf } from './page.ts';

const page = loadPage(
  '<html><head><title>t</title></head><body><main><p>a</p><p><span class="price">£3</span></p></main></body></html>',
);

describe('paths', () => {
  it('finds an element again from its path, as a browser box does', () => {
    const price = firstElement(page, '.price')!;
    expect(pathOf(price)).toEqual([1, 0, 1, 0]);
    expect(elementAt(page, pathOf(price))).toBe(price);
  });

  it('finds nothing at a path that isn’t there, or for a selector that matches nothing', () => {
    expect(elementAt(page, [1, 9])).toBeNull();
    expect(firstElement(page, '.missing')).toBeNull();
  });
});
