import { describe, expect, it } from 'vitest';
import { Rng } from '@core/index.ts';
import { SEEDS } from './helpers.ts';

const DRAW_COUNT = 20;
const WEIGHTED_SAMPLE_COUNT = 4000;

function draws(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.next());
}

describe('Rng determinism', () => {
  it('same seed (string) produces the same sequence', () => {
    const a = draws(Rng.create(SEEDS.rngBasic), DRAW_COUNT);
    const b = draws(Rng.create(SEEDS.rngBasic), DRAW_COUNT);
    expect(a).toEqual(b);
  });

  it('same seed (number) produces the same sequence', () => {
    const a = draws(Rng.create(12345), DRAW_COUNT);
    const b = draws(Rng.create(12345), DRAW_COUNT);
    expect(a).toEqual(b);
  });

  it('string and numeric seeds both yield values in [0, 1)', () => {
    for (const seed of [0, 1, -7, 999999999, 'alpha', '', 'château-fort'] as const) {
      const rng = Rng.create(seed);
      for (const v of draws(rng, 5)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('different seeds diverge', () => {
    const a = draws(Rng.create('seed-a'), 5);
    const b = draws(Rng.create('seed-b'), 5);
    expect(a).not.toEqual(b);
  });
});

describe('Rng.fork', () => {
  it('is independent of how many draws the parent already made', () => {
    const parent = Rng.create(SEEDS.rngFork);
    const childBefore = parent.fork('rivers');
    for (let i = 0; i < 50; i++) parent.next();
    const childAfter = parent.fork('rivers');
    expect(draws(childAfter, 10)).toEqual(draws(childBefore, 10));
  });

  it('is reproducible: same root seed + same label => same child stream', () => {
    const childA = Rng.create(SEEDS.rngFork).fork('forest-mask');
    const childB = Rng.create(SEEDS.rngFork).fork('forest-mask');
    expect(draws(childA, 10)).toEqual(draws(childB, 10));
  });

  it('different labels produce different streams', () => {
    const root = Rng.create(SEEDS.rngFork);
    const forkA = root.fork('layer-a');
    const forkB = root.fork('layer-b');
    expect(draws(forkA, 5)).not.toEqual(draws(forkB, 5));
  });

  it('numeric and string labels are both accepted and differ from each other', () => {
    const root = Rng.create(SEEDS.rngFork);
    const forkNum = root.fork(7);
    const forkStr = root.fork('7');
    expect(draws(forkNum, 5)).not.toEqual(draws(forkStr, 5));
  });
});

describe('Rng.getState / Rng.fromState', () => {
  it('resumes the exact same sequence after a round trip', () => {
    const rng = Rng.create('resume-me');
    draws(rng, 7); // burn some draws so state.a/b/c/d are non-trivial
    const state = rng.getState();
    const expectedContinuation = draws(rng, 10);

    const resumed = Rng.fromState(state);
    const actualContinuation = draws(resumed, 10);
    expect(actualContinuation).toEqual(expectedContinuation);
  });

  it('state is a plain snapshot: mutating one Rng does not affect another built from the same state', () => {
    const rng = Rng.create('snapshot');
    draws(rng, 3);
    const state = rng.getState();
    const branchA = Rng.fromState(state);
    const branchB = Rng.fromState(state);
    draws(branchA, 4); // advance only branchA
    expect(draws(branchB, 4)).toEqual(draws(Rng.fromState(state), 4));
  });
});

describe('Rng.int', () => {
  it('is inclusive on both bounds and always integral', () => {
    const rng = Rng.create('int-bounds');
    const min = -3;
    const max = 3;
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(min, max);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(min);
      expect(v).toBeLessThanOrEqual(max);
      seen.add(v);
    }
    // With 2000 draws over a 7-value range every value (including both extremes) must appear.
    expect([...seen].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it('a single-value range always returns that value', () => {
    const rng = Rng.create('int-single');
    for (let i = 0; i < 20; i++) expect(rng.int(5, 5)).toBe(5);
  });

  it('throws RangeError when max < min', () => {
    const rng = Rng.create('int-invalid');
    expect(() => rng.int(5, 4)).toThrow(RangeError);
  });

  it('throws RangeError for non-integer bounds', () => {
    const rng = Rng.create('int-invalid-2');
    expect(() => rng.int(0.5, 4)).toThrow(RangeError);
    expect(() => rng.int(0, 4.5)).toThrow(RangeError);
  });
});

describe('Rng.pick', () => {
  it('throws RangeError on an empty array', () => {
    const rng = Rng.create('pick-empty');
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('always returns an element of the input array', () => {
    const rng = Rng.create('pick-basic');
    const items = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
  });
});

describe('Rng.shuffle', () => {
  it('produces a permutation (same multiset) of the input', () => {
    const rng = Rng.create('shuffle-perm');
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle([...original]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });

  it('returns the same array instance it was given (in-place, chainable)', () => {
    const rng = Rng.create('shuffle-identity');
    const arr = [1, 2, 3];
    expect(rng.shuffle(arr)).toBe(arr);
  });

  it('is reproducible for a fixed seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const a = Rng.create('shuffle-repro').shuffle([...items]);
    const b = Rng.create('shuffle-repro').shuffle([...items]);
    expect(a).toEqual(b);
  });
});

describe('Rng.weightedIndex', () => {
  it('throws RangeError when a weight is negative', () => {
    const rng = Rng.create('weighted-negative');
    expect(() => rng.weightedIndex([1, -1])).toThrow(RangeError);
  });

  it('throws RangeError when total weight is zero', () => {
    const rng = Rng.create('weighted-zero');
    expect(() => rng.weightedIndex([0, 0, 0])).toThrow(RangeError);
  });

  it('never selects an index whose weight is zero', () => {
    const rng = Rng.create('weighted-skip-zero');
    const weights = [1, 0, 2];
    for (let i = 0; i < 500; i++) expect(rng.weightedIndex(weights)).not.toBe(1);
  });

  it('roughly respects proportions over many draws (coarse distribution check)', () => {
    const rng = Rng.create('weighted-distribution');
    const weights = [1, 3]; // index 1 should be picked ~3x as often as index 0
    let count0 = 0;
    let count1 = 0;
    for (let i = 0; i < WEIGHTED_SAMPLE_COUNT; i++) {
      if (rng.weightedIndex(weights) === 0) count0++;
      else count1++;
    }
    expect(count0).toBeGreaterThan(0);
    const ratio = count1 / count0;
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(4);
  });
});

describe('Rng.weighted', () => {
  it('picks the object proportionally to its .weight field', () => {
    const rng = Rng.create('weighted-object');
    const items = [
      { weight: 1, label: 'rare' },
      { weight: 0, label: 'never' },
    ] as const;
    for (let i = 0; i < 100; i++) expect(rng.weighted(items).label).toBe('rare');
  });
});

describe('Rng.gaussian', () => {
  it('always returns a finite number, with default and custom mean/stdDev', () => {
    const rng = Rng.create('gaussian-finite');
    for (let i = 0; i < 500; i++) {
      expect(Number.isFinite(rng.gaussian())).toBe(true);
      expect(Number.isFinite(rng.gaussian(10, 2))).toBe(true);
    }
  });

  it('is reproducible for a fixed seed', () => {
    const a = Rng.create('gaussian-seed').gaussian(5, 1);
    const b = Rng.create('gaussian-seed').gaussian(5, 1);
    expect(a).toBe(b);
  });
});

describe('Rng.chance / Rng.float', () => {
  it('chance(0) is always false and chance(1) is always true', () => {
    const rng = Rng.create('chance-edges');
    for (let i = 0; i < 20; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('float(min, max) stays within [min, max)', () => {
    const rng = Rng.create('float-range');
    for (let i = 0; i < 200; i++) {
      const v = rng.float(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
    }
  });
});
