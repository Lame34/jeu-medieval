/**
 * Seeded coherent noise for world generation. simplex-noise is fed by our deterministic Rng
 * (its permutation table is built from rng draws), and the rest is plain arithmetic.
 */
import { createNoise2D } from 'simplex-noise';
import type { Rng } from '../rng.ts';

export type Noise2D = (x: number, z: number) => number;

export interface FbmOptions {
  readonly octaves: number;
  readonly lacunarity: number;
  readonly gain: number;
  /** Base frequency in cycles per metre. */
  readonly frequency: number;
}

export const DEFAULT_FBM: FbmOptions = { octaves: 5, lacunarity: 2, gain: 0.5, frequency: 1 / 128 };

/** Raw simplex noise in [-1, 1]. */
export function createSimplex(rng: Rng): Noise2D {
  return createNoise2D(() => rng.next());
}

/** Fractal Brownian motion normalised to [-1, 1]. */
export function fbm(noise: Noise2D, x: number, z: number, options: FbmOptions = DEFAULT_FBM): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = options.frequency;
  let norm = 0;
  for (let i = 0; i < options.octaves; i++) {
    sum += amplitude * noise(x * frequency, z * frequency);
    norm += amplitude;
    amplitude *= options.gain;
    frequency *= options.lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged multifractal in [0, 1]: sharp crests, useful for escarpments. */
export function ridged(noise: Noise2D, x: number, z: number, options: FbmOptions = DEFAULT_FBM): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = options.frequency;
  let norm = 0;
  let weight = 1;
  for (let i = 0; i < options.octaves; i++) {
    let n = 1 - Math.abs(noise(x * frequency, z * frequency));
    n *= n * weight;
    weight = n;
    sum += amplitude * n;
    norm += amplitude;
    amplitude *= options.gain;
    frequency *= options.lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Domain-warped fBm: organic, non-grid-aligned shapes (forest masks, field boundaries). */
export function warpedFbm(
  noise: Noise2D,
  x: number,
  z: number,
  warpStrengthMetres: number,
  options: FbmOptions = DEFAULT_FBM,
): number {
  const WARP_OFFSET_A = 37.1;
  const WARP_OFFSET_B = 91.7;
  const qx = fbm(noise, x + WARP_OFFSET_A, z, options);
  const qz = fbm(noise, x, z + WARP_OFFSET_B, options);
  return fbm(noise, x + warpStrengthMetres * qx, z + warpStrengthMetres * qz, options);
}
