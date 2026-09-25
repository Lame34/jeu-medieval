import { describe, expect, it } from 'vitest';
import {
  EPSILON,
  add,
  clamp,
  clamp01,
  distance,
  distanceSq,
  dot,
  equals,
  inverseLerp,
  length,
  lerp,
  lerpVec,
  normalize,
  remap,
  scale,
  smoothstep,
  sub,
  vec2,
} from '@core/index.ts';

describe('scalar helpers', () => {
  it('clamp bounds a value into [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('clamp01 bounds a value into [0, 1]', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  it('lerp interpolates linearly, including outside [0, 1]', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20);
  });

  it('inverseLerp is the inverse of lerp, and returns 0 when a === b', () => {
    expect(inverseLerp(0, 10, 5)).toBe(0.5);
    expect(inverseLerp(5, 5, 5)).toBe(0);
    expect(inverseLerp(5, 5, 999)).toBe(0);
  });

  it('smoothstep is 0 at edge0, 1 at edge1, and 0.5 at the midpoint', () => {
    expect(smoothstep(0, 10, 0)).toBe(0);
    expect(smoothstep(0, 10, 10)).toBe(1);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 10);
    // Clamped outside the edges.
    expect(smoothstep(0, 10, -5)).toBe(0);
    expect(smoothstep(0, 10, 15)).toBe(1);
  });

  it('remap maps a value from one range to another', () => {
    expect(remap(5, 0, 10, 0, 100)).toBe(50);
    expect(remap(0, 0, 10, -1, 1)).toBe(-1);
    expect(remap(10, 0, 10, -1, 1)).toBe(1);
  });

  it('EPSILON is a small positive tolerance', () => {
    expect(EPSILON).toBeGreaterThan(0);
    expect(EPSILON).toBeLessThan(1e-6);
  });
});

describe('vec2 helpers', () => {
  it('add / sub are inverses', () => {
    const a = vec2(1, 2);
    const b = vec2(3, -4);
    expect(sub(add(a, b), b)).toEqual(a);
  });

  it('scale multiplies both components', () => {
    expect(scale(vec2(2, -3), 2)).toEqual({ x: 4, z: -6 });
  });

  it('dot computes the standard inner product', () => {
    expect(dot(vec2(1, 0), vec2(0, 1))).toBe(0);
    expect(dot(vec2(2, 3), vec2(4, 5))).toBe(2 * 4 + 3 * 5);
  });

  it('length matches Pythagoras, distance matches length of the difference', () => {
    expect(length(vec2(3, 4))).toBe(5);
    expect(distance(vec2(0, 0), vec2(3, 4))).toBe(5);
    expect(distanceSq(vec2(0, 0), vec2(3, 4))).toBe(25);
  });

  it('normalize returns a unit vector, and the zero vector maps to zero (no NaN)', () => {
    const n = normalize(vec2(3, 4));
    expect(length(n)).toBeCloseTo(1, 10);
    expect(normalize(vec2(0, 0))).toEqual({ x: 0, z: 0 });
  });

  it('lerpVec interpolates each component independently', () => {
    expect(lerpVec(vec2(0, 0), vec2(10, 20), 0.5)).toEqual({ x: 5, z: 10 });
  });

  it('equals compares within an epsilon', () => {
    expect(equals(vec2(1, 1), vec2(1, 1))).toBe(true);
    expect(equals(vec2(1, 1), vec2(1.0000000001, 1), 1e-6)).toBe(true);
    expect(equals(vec2(1, 1), vec2(1.1, 1))).toBe(false);
  });
});
