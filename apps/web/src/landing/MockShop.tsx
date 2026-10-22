import { formatMoney } from '../lib/money.ts';

/** A block's box in each layout, in percent of the page: x, y, width, height. */
type Rect = readonly [number, number, number, number];

const CLASSIC = {
  breadcrumb: [5, 12, 50, 4],
  image: [5, 19, 44, 56],
  title: [54, 19, 41, 11],
  rating: [54, 31, 36, 4],
  price: [54, 42, 30, 8],
  was: [54, 50, 30, 4],
  button: [54, 57, 32, 8],
  copy: [54, 69, 41, 14],
} as const satisfies Record<string, Rect>;

const REDESIGN = {
  breadcrumb: [5, 12, 50, 4],
  image: [0, 9, 100, 38],
  title: [5, 51, 56, 11],
  rating: [5, 63, 36, 4],
  price: [62, 50, 33, 11],
  was: [62, 61.5, 33, 4],
  button: [5, 71, 90, 8],
  copy: [5, 83, 90, 11],
} as const satisfies Record<string, Rect>;

type Block = keyof typeof CLASSIC;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function box(block: Block, m: number) {
  const a = CLASSIC[block];
  const b = REDESIGN[block];
  return {
    left: `${lerp(a[0], b[0], m)}%`,
    top: `${lerp(a[1], b[1], m)}%`,
    width: `${lerp(a[2], b[2], m)}%`,
    height: `${lerp(a[3], b[3], m)}%`,
  };
}

/** Where the price sits, padded, for the watch box. */
export function priceBox(m: number) {
  const a = CLASSIC.price;
  const b = REDESIGN.price;
  return [
    lerp(a[0], b[0], m) - 1.2,
    lerp(a[1], b[1], m) - 1.2,
    lerp(a[2], b[2], m) + 2.4,
    lerp(a[3], b[3], m) + 2.4,
  ] as const;
}

// Speckles for the mug, from a fixed seed so every render draws the same mug.
const SPECKLES = (() => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 70 }, () => ({
    x: 70 + random() * 120,
    y: 62 + random() * 110,
    r: 0.6 + random() * 1.6,
  }));
})();

/** A speckled stoneware mug, drawn as code: no stock photos, no licences. */
function Mug() {
  return (
    <svg viewBox="0 0 260 220" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
      <rect width="260" height="220" fill="#EDE6DC" />
      <ellipse cx="130" cy="182" rx="78" ry="10" fill="#D9CFC2" />
      <path
        d="M190 85c32 0 34 58 0 58"
        fill="none"
        stroke="#F4EFE7"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d="M190 85c32 0 34 58 0 58"
        fill="none"
        stroke="#E3DACD"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <rect x="66" y="56" width="128" height="124" rx="16" fill="#F4EFE7" />
      <rect x="66" y="56" width="128" height="14" rx="7" fill="#E9E1D5" />
      {SPECKLES.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#6B5D4F" opacity={0.55} />
      ))}
    </svg>
  );
}

interface MockShopProps {
  /** 0 = the classic layout, 1 = the redesign. */
  morph: number;
  price: number;
  was?: number;
  watch: { state: 'watching' | 'lost' | 'healed'; heal: number };
  /** The strip under the page showing the price element's markup. */
  showMarkup?: boolean;
}

/**
 * Fickle's product page, as somebody else's website: its own type, its own
 * colours, always light. Blocks move between two layouts as the page redesigns.
 */
export function MockShop({ morph, price, was, watch, showMarkup = true }: MockShopProps) {
  const redesigned = morph > 0.5;
  const watched = watch.state === 'healed' ? priceBox(watch.heal) : priceBox(0);
  const watchColour = watch.state === 'lost' ? 'var(--danger)' : 'var(--copper)';
  const watchLabel =
    watch.state === 'watching'
      ? 'watching .price-now'
      : watch.state === 'lost'
        ? '.price-now matched nothing'
        : 'healed · [data-price]';

  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_1px_0_var(--line)]">
      <div className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-line" />
          <span className="size-2.5 rounded-full bg-line" />
          <span className="size-2.5 rounded-full bg-line" />
        </span>
        <span className="tabular min-w-0 truncate rounded-md bg-paper px-3 py-1 text-[11px] text-ink-2">
          fickle.ingenio-algomancer.com/p/stoneware-mug
        </span>
      </div>

      <div
        className="relative aspect-[10/9] overflow-hidden bg-white text-[#1d1b18] [container-type:inline-size]"
        style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
      >
        <div
          className="absolute inset-x-0 top-0 flex h-[9%] items-center justify-between px-[5%] text-[2.1cqw] transition-colors duration-300"
          style={{
            background: redesigned ? '#1d1b18' : '#fff',
            color: redesigned ? '#fff' : '#1d1b18',
          }}
        >
          <span className="text-[3.4cqw] font-black lowercase tracking-tight">fickle</span>
          <span className="flex gap-[3cqw] opacity-80">
            <span>Kitchen</span>
            <span>Desk</span>
            <span>Home</span>
            <span className="font-semibold">Sale</span>
          </span>
        </div>
        <div className="absolute inset-x-0 top-[9%] h-px bg-[#e8e2da]" />

        <div
          className="absolute text-[1.9cqw] text-[#8a8178]"
          style={{ ...box('breadcrumb', morph), opacity: 1 - morph }}
        >
          Home / Kitchen / Mugs
        </div>
        <div
          className="absolute overflow-hidden rounded-[1.2cqw] bg-[#EDE6DC]"
          style={box('image', morph)}
        >
          <Mug />
        </div>
        <div
          className="absolute leading-[1.1]"
          style={{
            ...box('title', morph),
            fontFamily: 'Georgia, serif',
            fontSize: `${lerp(4.6, 5.2, morph)}cqw`,
          }}
        >
          Stoneware mug, speckled
        </div>
        <div className="absolute text-[2cqw] text-[#8a8178]" style={box('rating', morph)}>
          <span className="text-[#c9a227]">★★★★☆</span> 128 reviews
        </div>
        <div
          className="absolute flex items-start font-semibold"
          style={{
            ...box('price', morph),
            fontSize: `${lerp(4.4, 6.6, morph)}cqw`,
            justifyContent: morph > 0.5 ? 'flex-end' : 'flex-start',
            color: was ? '#b3261e' : '#1d1b18',
          }}
        >
          {formatMoney(price)}
        </div>
        {was ? (
          <div
            className="absolute text-[2.2cqw] text-[#8a8178]"
            style={{ ...box('was', morph), textAlign: morph > 0.5 ? 'right' : 'left' }}
          >
            was <s>{formatMoney(was)}</s> ·{' '}
            <span className="font-semibold text-[#b3261e]">Sale</span>
          </div>
        ) : null}
        <div
          className="absolute grid place-items-center rounded-[1cqw] bg-[#1d1b18] text-[2.3cqw] font-medium text-white"
          style={box('button', morph)}
        >
          Add to basket
        </div>
        <div className="absolute flex flex-col gap-[1.4cqw]" style={box('copy', morph)}>
          <span className="h-[1.3cqw] w-full rounded-full bg-[#eee8e0]" />
          <span className="h-[1.3cqw] w-[92%] rounded-full bg-[#eee8e0]" />
          <span className="h-[1.3cqw] w-[70%] rounded-full bg-[#eee8e0]" />
        </div>

        {/* What Pennydrop is watching on this page. */}
        <div
          className="pointer-events-none absolute rounded-[0.8cqw] border-2 border-dashed transition-colors duration-200"
          style={{
            left: `${watched[0]}%`,
            top: `${watched[1]}%`,
            width: `${watched[2]}%`,
            height: `${watched[3]}%`,
            borderColor: watchColour,
          }}
        >
          <span
            className="tabular absolute -top-[3.6cqw] left-0 whitespace-nowrap rounded-[0.6cqw] px-[1cqw] py-[0.3cqw] text-[1.8cqw] font-medium"
            style={{
              background: watchColour,
              color: watch.state === 'lost' ? '#fff' : 'var(--on-copper)',
            }}
          >
            {watchLabel}
          </span>
        </div>
      </div>

      {showMarkup && (
        <div className="tabular border-t border-line bg-surface px-4 py-3 text-[11px] leading-5 text-ink-2">
          <div
            className="transition-opacity duration-300"
            style={{ opacity: redesigned ? 0.45 : 1 }}
          >
            {redesigned ? <s>{'<span class="price-now">'}</s> : '<span class="price-now">'}
            <span className="text-ink">{formatMoney(price)}</span>
            {'</span>'}
          </div>
          <div className="transition-opacity duration-300" style={{ opacity: redesigned ? 1 : 0 }}>
            {'<div class="pdp__amount" '}
            <span className="font-semibold text-copper-deep">data-price</span>
            {'>'}
            <span className="text-ink">{formatMoney(price)}</span>
            {'</div>'}
          </div>
        </div>
      )}
    </div>
  );
}
