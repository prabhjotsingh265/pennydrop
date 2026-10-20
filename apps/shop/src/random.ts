/**
 * A number in [0, 1) that depends only on its inputs. The shop's prices,
 * sales, stock and pictures all come from this, so the same moment always
 * shows the same page, and tests know exactly what to expect.
 */
export function hash01(...parts: (string | number)[]): number {
  // FNV-1a over the joined parts, then a mulberry32 round to spread the bits.
  let h = 0x811c9dc5;
  for (const char of parts.join(':')) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}
