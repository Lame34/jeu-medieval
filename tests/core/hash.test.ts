import { describe, expect, it } from 'vitest';
import { canonicalStringify, fnv1a32, hash64Hex, hashCombine, hashValue, mix32 } from '@core/index.ts';

describe('canonicalStringify', () => {
  it('is insensitive to object key order', () => {
    expect(canonicalStringify({ a: 1, b: 2, c: 3 })).toBe(canonicalStringify({ c: 3, a: 1, b: 2 }));
  });

  it('sorts nested object keys too', () => {
    const x = canonicalStringify({ outer: { z: 1, y: 2 }, other: true });
    const y = canonicalStringify({ other: true, outer: { y: 2, z: 1 } });
    expect(x).toBe(y);
  });

  it('drops keys whose value is undefined, but keeps the resulting object stable', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalStringify({ a: 1 })).toBe(canonicalStringify({ a: 1, b: undefined }));
  });

  it('expands typed arrays like plain arrays', () => {
    expect(canonicalStringify(new Float32Array([1, 2, 3]))).toBe('[1,2,3]');
    expect(canonicalStringify(new Uint8Array([1, 2, 3]))).toBe(canonicalStringify([1, 2, 3]));
    expect(canonicalStringify(new Int32Array([-1, 0, 5]))).toBe('[-1,0,5]');
  });

  it('tags non-finite numbers instead of collapsing them to null', () => {
    expect(canonicalStringify(Number.NaN)).toBe('"#num:NaN"');
    expect(canonicalStringify(Number.POSITIVE_INFINITY)).toBe('"#num:Infinity"');
    expect(canonicalStringify(Number.NEGATIVE_INFINITY)).toBe('"#num:-Infinity"');
    // Sanity: NaN and Infinity must not collide with each other or with a finite number.
    expect(canonicalStringify(Number.NaN)).not.toBe(canonicalStringify(Number.POSITIVE_INFINITY));
  });

  it('tags a bare undefined value', () => {
    expect(canonicalStringify(undefined)).toBe('"#undef"');
  });

  it('recurses into arrays, keeping undefined entries tagged (unlike object keys)', () => {
    expect(canonicalStringify([1, undefined, 3])).toBe('[1,"#undef",3]');
  });

  it('two structurally equal states with different construction produce the same string', () => {
    const a = { units: [{ id: 'b', hp: 1 }, { id: 'a', hp: 2 }], turn: 1 };
    const b = { turn: 1, units: [{ hp: 1, id: 'b' }, { hp: 2, id: 'a' }] };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });
});

describe('hash64Hex', () => {
  // Locked reference values: computed once from the current implementation. Any change to
  // fnv1a32/hash64Hex that alters these outputs is a breaking change to save/replay hashes.
  it('is a fixed, known value for a given input', () => {
    expect(hash64Hex('hello')).toBe('39d0e0ec4f9f2cab');
    expect(hash64Hex('')).toBe('9747b28c811c9dc5');
  });

  it('is deterministic across repeated calls', () => {
    expect(hash64Hex('siege-battle-state')).toBe(hash64Hex('siege-battle-state'));
  });

  it('is a 16-character lowercase hex string', () => {
    const h = hash64Hex('some arbitrary text');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs for different inputs (no trivial collision for near-identical strings)', () => {
    expect(hash64Hex('a')).not.toBe(hash64Hex('b'));
    expect(hash64Hex('archer')).not.toBe(hash64Hex('archer2'));
  });
});

describe('hashValue', () => {
  it('hashes the canonical form: key order does not change the hash', () => {
    expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ b: 2, a: 1 }));
  });

  it('changes when the underlying data changes', () => {
    expect(hashValue({ turn: 1 })).not.toBe(hashValue({ turn: 2 }));
  });
});

describe('mix32', () => {
  it('is a fixed, known value for given inputs', () => {
    expect(mix32(0)).toBe(0);
    expect(mix32(1)).toBe(1364076727);
  });

  it('is deterministic and stays within uint32 range', () => {
    for (const v of [0, 1, 42, 0xffffffff, 123456789]) {
      const h = mix32(v);
      expect(mix32(v)).toBe(h);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('avalanches: close inputs produce very different outputs', () => {
    expect(mix32(1)).not.toBe(mix32(2));
    expect(mix32(1000)).not.toBe(mix32(1001));
  });
});

describe('hashCombine', () => {
  it('is deterministic', () => {
    expect(hashCombine(1, 2)).toBe(hashCombine(1, 2));
  });

  it('is not commutative in general', () => {
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
  });

  it('produces a value within uint32 range', () => {
    const h = hashCombine(123456, 789012);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('fnv1a32', () => {
  it('is deterministic for a given input and seed', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'));
  });

  it('a custom seed changes the output', () => {
    expect(fnv1a32('abc', 1)).not.toBe(fnv1a32('abc'));
  });
});
