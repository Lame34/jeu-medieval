import { describe, expect, it } from 'vitest';
import { DEFAULT_FBM, Rng, createSimplex, fbm, ridged, warpedFbm, type Noise2D } from '@core/index.ts';
import { SEEDS } from './helpers.ts';

const SAMPLE_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.5, -3.2],
  [100, 200],
  [-42.25, 17.75],
  [0.001, 0.001],
  [512, -512],
];

function newNoise(): Noise2D {
  return createSimplex(Rng.create(SEEDS.noise));
}

describe('fbm', () => {
  it('is deterministic: two simplex fields built from the same seed agree everywhere sampled', () => {
    const noiseA = newNoise();
    const noiseB = newNoise();
    for (const [x, z] of SAMPLE_POINTS) expect(fbm(noiseA, x, z)).toBe(fbm(noiseB, x, z));
  });

  it('stays within [-1, 1]', () => {
    const noise = newNoise();
    for (let x = -50; x <= 50; x += 5) {
      for (let z = -50; z <= 50; z += 5) {
        const v = fbm(noise, x, z);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('respects a custom FbmOptions (single octave differs from the 5-octave default)', () => {
    const noise = newNoise();
    const singleOctave = { ...DEFAULT_FBM, octaves: 1 };
    expect(fbm(noise, 12.3, 45.6, singleOctave)).not.toBe(fbm(noise, 12.3, 45.6));
  });
});

describe('ridged', () => {
  it('is deterministic for a given seed', () => {
    const noiseA = newNoise();
    const noiseB = newNoise();
    for (const [x, z] of SAMPLE_POINTS) expect(ridged(noiseA, x, z)).toBe(ridged(noiseB, x, z));
  });

  it('stays within [0, 1]', () => {
    const noise = newNoise();
    for (let x = -50; x <= 50; x += 5) {
      for (let z = -50; z <= 50; z += 5) {
        const v = ridged(noise, x, z);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('warpedFbm', () => {
  it('is deterministic for a given seed and warp strength', () => {
    const noiseA = newNoise();
    const noiseB = newNoise();
    for (const [x, z] of SAMPLE_POINTS) {
      expect(warpedFbm(noiseA, x, z, 20)).toBe(warpedFbm(noiseB, x, z, 20));
    }
  });

  it('stays within [-1, 1] (it ultimately samples fbm at warped coordinates)', () => {
    const noise = newNoise();
    for (let x = -30; x <= 30; x += 6) {
      for (let z = -30; z <= 30; z += 6) {
        const v = warpedFbm(noise, x, z, 15);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('differs from unwarped fbm at the same point when warp strength is non-zero', () => {
    const noise = newNoise();
    // Not a universal law, but true for this seed/point set: warping perturbs the input enough
    // to change the sampled value at nearly every point.
    let differences = 0;
    for (const [x, z] of SAMPLE_POINTS) {
      if (warpedFbm(noise, x, z, 30) !== fbm(noise, x, z)) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
});
