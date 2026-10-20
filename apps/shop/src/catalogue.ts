import { hash01 } from './random.ts';

export type Kind = 'mug' | 'bowl' | 'board' | 'kettle' | 'lamp' | 'notebook' | 'vase' | 'candle';
export type Category = 'kitchen' | 'desk' | 'home';

export interface Product {
  slug: string;
  name: string;
  kind: Kind;
  category: Category;
  /** Starting price in pence. */
  base: number;
  blurb: string;
  /** Prices end in .99 rather than .00 or .50. */
  charm: boolean;
  /** Listed under /clearance/, which robots.txt asks crawlers to stay out of. */
  clearance: boolean;
  sku: string;
  gtin13: string;
}

export const CATEGORIES: Record<Category, string> = {
  kitchen: 'Kitchen',
  desk: 'Desk',
  home: 'Home',
};

// [slug, name, kind, category, base price in pence, blurb]
const ROWS: [string, string, Kind, Category, number, string][] = [
  [
    'stoneware-mug',
    'Stoneware mug, speckled',
    'mug',
    'kitchen',
    4800,
    'Thrown in small batches, glazed in oatmeal with iron speckles. Holds 350 ml.',
  ],
  [
    'ink-blue-mug',
    'Stoneware mug, ink blue',
    'mug',
    'kitchen',
    3200,
    'A deep blue glaze that pools darker at the rim. Holds 300 ml.',
  ],
  [
    'espresso-cup',
    'Espresso cup, chalk',
    'mug',
    'kitchen',
    1800,
    'A thick-walled cup that keeps a double shot hot.',
  ],
  [
    'enamel-colander',
    'Enamel colander',
    'bowl',
    'kitchen',
    2600,
    'Enamelled steel with a rolled rim and two loop handles.',
  ],
  [
    'serving-bowl',
    'Ceramic serving bowl',
    'bowl',
    'kitchen',
    3900,
    'Wide and shallow, for salads and long lunches.',
  ],
  [
    'ramen-bowl',
    'Ramen bowl, ash glaze',
    'bowl',
    'kitchen',
    2200,
    'Deep enough for broth, noodles and everything on top.',
  ],
  [
    'walnut-board',
    'Walnut chopping board',
    'board',
    'kitchen',
    4400,
    'End-grain walnut, oiled by hand. Kind to knives.',
  ],
  [
    'oak-board',
    'Oak serving board',
    'board',
    'kitchen',
    3500,
    'A long oak board with a hanging hole and soft edges.',
  ],
  [
    'marble-board',
    'Marble cheese board',
    'board',
    'kitchen',
    5200,
    'Cool white marble on cork feet.',
  ],
  [
    'cast-iron-kettle',
    'Cast-iron kettle',
    'kettle',
    'kitchen',
    7600,
    'Heavy, quiet and slow to cool. Enamelled inside.',
  ],
  [
    'copper-kettle',
    'Stovetop kettle, copper',
    'kettle',
    'kitchen',
    8900,
    'Whistles when it boils. Polishes up like new.',
  ],
  [
    'pour-over-set',
    'Ceramic pour-over set',
    'kettle',
    'kitchen',
    4100,
    'Dripper, carafe and two cups in matching glaze.',
  ],
  [
    'brass-lamp',
    'Brass desk lamp',
    'lamp',
    'desk',
    6400,
    'Solid brass with a pivoting head and a cloth cable.',
  ],
  [
    'clamp-lamp',
    'Clamp lamp, sage',
    'lamp',
    'desk',
    3800,
    'Clamps to a shelf or desk edge. Takes any E27 bulb.',
  ],
  [
    'pleated-lamp',
    'Pleated table lamp',
    'lamp',
    'desk',
    5600,
    'A pleated paper shade on a stoneware base.',
  ],
  [
    'dot-notebook',
    'Dot-grid notebook',
    'notebook',
    'desk',
    1600,
    'A5, 192 pages of 100 gsm paper that takes fountain pen ink.',
  ],
  [
    'linen-sketchbook',
    'Linen sketchbook',
    'notebook',
    'desk',
    2400,
    'Linen-bound, lies flat, thick enough for watercolour.',
  ],
  [
    'weekly-planner',
    'Weekly planner',
    'notebook',
    'desk',
    2000,
    'Undated, so it starts the week you do.',
  ],
  [
    'bud-vase',
    'Bud vase, smoke glass',
    'vase',
    'home',
    1900,
    'Hand-blown smoke glass for a single stem.',
  ],
  [
    'tall-vase',
    'Stoneware vase, tall',
    'vase',
    'home',
    5400,
    'Tall enough for branches. Raw clay outside, glazed within.',
  ],
  ['ribbed-vase', 'Ribbed vase', 'vase', 'home', 3300, 'Ribbed ceramic that throws soft shadows.'],
  [
    'beeswax-candle',
    'Beeswax pillar candle',
    'candle',
    'home',
    1400,
    'Pure beeswax, burns for about forty hours.',
  ],
  [
    'fig-candle',
    'Fig and cedar candle',
    'candle',
    'home',
    2800,
    'Soy wax in a reusable stoneware pot.',
  ],
  [
    'taper-candles',
    'Taper candles, pair',
    'candle',
    'home',
    1200,
    'Dripless, hand-dipped, in four colours.',
  ],
];

/** EAN-13 in the 200–299 range, which is reserved for in-store use: it can never clash with a real product. */
function gtin13(index: number): string {
  const body = `200${String(1_000_000 + index * 7919).padStart(9, '0')}`;
  const sum = [...body].reduce(
    (total, digit, i) => total + Number(digit) * (i % 2 === 0 ? 1 : 3),
    0,
  );
  return body + ((10 - (sum % 10)) % 10);
}

export const PRODUCTS: Product[] = ROWS.map(([slug, name, kind, category, base, blurb], index) => ({
  slug,
  name,
  kind,
  category,
  base,
  blurb,
  charm: hash01(slug, 'charm') < 0.4,
  clearance: slug === 'taper-candles' || slug === 'espresso-cup',
  sku: `FK-${String(index + 101).padStart(4, '0')}`,
  gtin13: gtin13(index),
}));

const BY_SLUG = new Map(PRODUCTS.map((product) => [product.slug, product]));

export function findProduct(slug: string): Product | undefined {
  return BY_SLUG.get(slug);
}
