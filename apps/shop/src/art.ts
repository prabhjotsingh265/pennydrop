import type { Product } from './catalogue.ts';
import { hash01 } from './random.ts';

// Product pictures are drawn from each product's seed: no stock photos, no licences.

const GLAZES = [
  '#F4EFE7',
  '#2E3A4F',
  '#9DAF95',
  '#C4704F',
  '#D9A441',
  '#9A9890',
  '#E8B4A6',
  '#3F5D4A',
  '#7A8FA6',
];
const GROUNDS = ['#EDE6DC', '#E7ECEF', '#EFE9E1', '#E9EEE6', '#F1E8E4'];
const WOODS = ['#8B5E3C', '#B08455', '#6F4A2F', '#E6E2DC'];

// Where a product's name or description gives its colour, the picture uses it.
const NAMED: Record<string, string> = {
  'stoneware-mug': '#E9E1D3',
  'ink-blue-mug': '#2E3A4F',
  'espresso-cup': '#F4EFE7',
  'ramen-bowl': '#9A9890',
  'walnut-board': '#6F4A2F',
  'oak-board': '#B08455',
  'marble-board': '#E6E2DC',
  'cast-iron-kettle': '#3A3A3A',
  'copper-kettle': '#B87333',
  'clamp-lamp': '#9DAF95',
  'bud-vase': '#6E6A66',
  'beeswax-candle': '#E8C468',
};

function pick<T>(list: readonly T[], ...seed: (string | number)[]): T {
  return list[Math.floor(hash01(...seed) * list.length)]!;
}

function speckles(
  slug: string,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
): string {
  return Array.from({ length: 46 }, (_, i) => {
    const cx = x + hash01(slug, 'sx', i) * w;
    const cy = y + hash01(slug, 'sy', i) * h;
    const r = 0.8 + hash01(slug, 'sr', i) * 2.2;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${colour}" opacity=".5"/>`;
  }).join('');
}

const SHAPES: Record<Product['kind'], (slug: string, glaze: string, accent: string) => string> = {
  mug: (slug, glaze) =>
    `<path d="M262 170c50 0 52 92 0 92" fill="none" stroke="${glaze}" stroke-width="22" stroke-linecap="round"/>` +
    `<rect x="128" y="138" width="144" height="190" rx="18" fill="${glaze}"/>` +
    `<rect x="128" y="138" width="144" height="16" rx="8" fill="#000" opacity=".06"/>` +
    speckles(slug, 138, 160, 124, 160, '#5B4636'),
  bowl: (_slug, glaze, accent) =>
    `<path d="M80 200h240c0 76-54 128-120 128S80 276 80 200z" fill="${glaze}"/>` +
    `<ellipse cx="200" cy="200" rx="120" ry="24" fill="${accent}"/>` +
    `<path d="M92 236h216" stroke="#000" stroke-opacity=".08" stroke-width="10"/>`,
  board: (slug) => {
    const wood = NAMED[slug] ?? pick(WOODS, slug, 'wood');
    return (
      `<g transform="rotate(-8 200 240)"><rect x="60" y="176" width="280" height="140" rx="24" fill="${wood}"/>` +
      `<circle cx="308" cy="246" r="10" fill="#EDE6DC"/>` +
      [0, 1, 2, 3]
        .map(
          (i) =>
            `<path d="M84 ${206 + i * 24}c60-10 120 10 196 0" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="3"/>`,
        )
        .join('') +
      `</g>`
    );
  },
  kettle: (_slug, glaze) =>
    `<path d="M160 120c0-30 80-30 80 0" fill="none" stroke="#2B2B2B" stroke-width="12"/>` +
    `<path d="M116 320c-6-90 30-170 84-170s90 80 84 170z" fill="${glaze}"/>` +
    `<path d="M120 236c-40-6-62-36-70-64" fill="none" stroke="${glaze}" stroke-width="18" stroke-linecap="round"/>` +
    `<circle cx="200" cy="146" r="12" fill="#2B2B2B"/>`,
  lamp: (_slug, glaze, accent) =>
    `<ellipse cx="160" cy="318" rx="70" ry="14" fill="#2B2B2B"/>` +
    `<path d="M160 314L210 190L268 150" fill="none" stroke="#2B2B2B" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M236 110l90 40-40 70-84-56z" fill="${glaze}"/>` +
    `<circle cx="262" cy="196" r="20" fill="${accent}" opacity=".35"/>`,
  notebook: (_slug, glaze, accent) =>
    `<rect x="120" y="96" width="170" height="232" rx="10" fill="${glaze}"/>` +
    `<rect x="120" y="96" width="22" height="232" rx="6" fill="#000" opacity=".12"/>` +
    `<rect x="250" y="96" width="10" height="232" fill="${accent}"/>` +
    `<rect x="160" y="140" width="80" height="34" rx="4" fill="#fff" opacity=".7"/>`,
  vase: (_slug, glaze) =>
    `<path d="M176 100h48c0 40-10 52 10 90 26 50 22 110-34 138-56-28-60-88-34-138 20-38 10-50 10-90z" fill="${glaze}"/>` +
    [0, 1, 2, 3, 4]
      .map(
        (i) =>
          `<path d="M${170 + i * 15} 200v110" stroke="#000" stroke-opacity=".07" stroke-width="4"/>`,
      )
      .join(''),
  candle: (_slug, glaze) =>
    `<rect x="150" y="160" width="100" height="170" rx="8" fill="${glaze}"/>` +
    `<path d="M200 106c18 22 16 44 0 50-16-6-18-28 0-50z" fill="#E9A23B"/>` +
    `<path d="M200 150v12" stroke="#2B2B2B" stroke-width="3"/>` +
    `<path d="M168 160v30a8 8 0 0 0 16 0v-30" fill="${glaze}" stroke="#000" stroke-opacity=".08"/>`,
};

export function productArt(product: Product): string {
  const glaze = NAMED[product.slug] ?? pick(GLAZES, product.slug, 'glaze');
  const accent = pick(GLAZES, product.slug, 'accent');
  const ground = pick(GROUNDS, product.slug, 'ground');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">` +
    `<rect width="400" height="400" fill="${ground}"/>` +
    `<ellipse cx="200" cy="332" rx="140" ry="16" fill="#000" opacity=".07"/>` +
    SHAPES[product.kind](product.slug, glaze, accent) +
    `</svg>`
  );
}
