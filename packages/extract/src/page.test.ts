import { describe, expect, it } from 'vitest';
import { elementAt, firstElement, loadPage, looksLikeListing, pathOf } from './page.ts';

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

const card = (name: string, price: string) =>
  `<a class="card" href="/p/${name}"><span class="card-name">${name}</span><span class="card-price">${price}</span></a>`;

describe('looksLikeListing', () => {
  it('knows a grid of products with nowhere to buy', () => {
    const grid = ['mug', 'vase', 'lamp', 'bowl'].map((n, i) => card(n, `£${10 + i}.00`)).join('');
    expect(looksLikeListing(loadPage(`<html><body><h1>Kitchen</h1>${grid}</body></html>`))).toBe(
      true,
    );
  });

  it('keeps a product page with related products below it a product page', () => {
    const grid = ['mug', 'vase', 'lamp', 'bowl'].map((n, i) => card(n, `£${10 + i}.00`)).join('');
    const html = `<html><body><h1>Kettle</h1><p class="price">£45.00</p><button>Add to basket</button>${grid}</body></html>`;
    expect(looksLikeListing(loadPage(html))).toBe(false);
  });

  it('isn’t fooled by a few prices on one product', () => {
    const html =
      '<html><body><h1>Kettle</h1><p class="price">£45.00</p><s class="price">£60.00</s><span>Save £15.00</span></body></html>';
    expect(looksLikeListing(loadPage(html))).toBe(false);
  });
});
