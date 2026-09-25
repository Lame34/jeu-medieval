/** Integer hashing helpers. All operations are 32-bit exact, hence engine-independent. */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const MIX_MUL_A = 0x85ebca6b;
const MIX_MUL_B = 0xc2b2ae35;
const SECOND_HASH_SALT = 0x9747b28c;

/** FNV-1a over UTF-16 code units. */
export function fnv1a32(text: string, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Murmur3 finalizer: good avalanche for integer keys. */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, MIX_MUL_A);
  h ^= h >>> 13;
  h = Math.imul(h, MIX_MUL_B);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashCombine(a: number, b: number): number {
  return mix32((a ^ (mix32(b) + 0x9e3779b9 + (a << 6) + (a >>> 2))) >>> 0);
}

/** 64-bit (two independent 32-bit lanes) hex digest of a string. */
export function hash64Hex(text: string): string {
  const lo = fnv1a32(text);
  const hi = fnv1a32(text, SECOND_HASH_SALT);
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/**
 * Canonical serialization: object keys sorted, typed arrays expanded, non-finite numbers tagged.
 * Two structurally equal states always produce the same string.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return `"#num:${String(value)}"`;
    if (value === undefined) return '"#undef"';
    return JSON.stringify(value);
  }
  if (ArrayBuffer.isView(value)) {
    return canonicalStringify(Array.from(value as unknown as ArrayLike<number>));
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(record[k])}`).join(',')}}`;
}

export function hashValue(value: unknown): string {
  return hash64Hex(canonicalStringify(value));
}
