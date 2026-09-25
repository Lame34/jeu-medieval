/**
 * Deterministic seeded PRNG for the simulation core.
 *
 * - Generator: sfc32 (Small Fast Counting, 128-bit state), seeded through splitmix32.
 *   Pure 32-bit integer arithmetic, so the sequence is bit-identical on every JS engine.
 * - `fork(label)` derives an independent child stream from the ROOT seed key and a label,
 *   never from the parent's current position: adding a draw in one generation stage cannot
 *   shift the output of another stage.
 */
import { fnv1a32, mix32 } from './math/hash.ts';

const UINT32_RANGE = 4294967296;
const SPLITMIX_INCREMENT = 0x9e3779b9;
const SPLITMIX_MUL_A = 0x21f0aaad;
const SPLITMIX_MUL_B = 0x735a2d97;
/** Draws discarded after seeding so that close seeds diverge immediately. */
const WARMUP_DRAWS = 12;

export type Seed = number | string;

export interface RngState {
  readonly seedKey: number;
  readonly s: readonly [number, number, number, number];
}

export interface Weighted {
  readonly weight: number;
}

export function seedToKey(seed: Seed): number {
  return typeof seed === 'number' ? mix32(seed >>> 0 ^ Math.trunc(seed / UINT32_RANGE)) : fnv1a32(seed);
}

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + SPLITMIX_INCREMENT) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, SPLITMIX_MUL_A);
    t ^= t >>> 15;
    t = Math.imul(t, SPLITMIX_MUL_B);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

export class Rng {
  readonly seedKey: number;
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(seedKey: number, state?: readonly [number, number, number, number]) {
    this.seedKey = seedKey >>> 0;
    if (state) {
      [this.a, this.b, this.c, this.d] = state;
      return;
    }
    const sm = splitmix32(this.seedKey);
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    for (let i = 0; i < WARMUP_DRAWS; i++) this.nextU32();
  }

  static create(seed: Seed): Rng {
    return new Rng(seedToKey(seed));
  }

  static fromState(state: RngState): Rng {
    return new Rng(state.seedKey, state.s);
  }

  getState(): RngState {
    return { seedKey: this.seedKey, s: [this.a, this.b, this.c, this.d] };
  }

  /** Independent, reproducible child stream. Same label on the same root ⇒ same stream. */
  fork(label: string | number): Rng {
    const labelKey = typeof label === 'number' ? mix32(label >>> 0) : fnv1a32(label);
    return new Rng(mix32(this.seedKey ^ mix32(labelKey)));
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / UINT32_RANGE;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (both inclusive). */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Rng.int: invalid range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Standard normal sample via Box–Muller (uses only sqrt/log/cos of this engine). */
  gaussian(mean = 0, stdDev = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Fisher–Yates shuffle, in place. Returns the same array for chaining. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** Index drawn proportionally to non-negative weights. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) {
      if (!(w >= 0)) throw new RangeError('Rng.weightedIndex: weights must be >= 0');
      total += w;
    }
    if (total <= 0) throw new RangeError('Rng.weightedIndex: total weight must be > 0');
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return i;
    }
    // Floating-point safety: return the last positive-weight entry.
    for (let i = weights.length - 1; i >= 0; i--) if ((weights[i] as number) > 0) return i;
    return weights.length - 1;
  }

  weighted<T extends Weighted>(items: readonly T[]): T {
    return items[this.weightedIndex(items.map((it) => it.weight))] as T;
  }
}
