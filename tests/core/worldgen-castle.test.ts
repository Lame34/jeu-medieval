/**
 * src/core/worldgen/castle.ts: pure, fast geometry (no map generation involved), so every test
 * here builds its own tiny CastleParams and runs in milliseconds.
 */
import { describe, expect, it } from 'vitest';
import { planCastle, ringRadiusAt, turnsFacing, type CastleParams } from '@core/worldgen/castle.ts';
import { projectOnPolyline } from '@core/worldgen/geometry.ts';
import type { Vec2 } from '@core/math/vec2.ts';
import { Rng } from '@core/rng.ts';

/** A square centred on the origin, corners at (+-5, +-5): the "simple case" ringRadiusAt fixture. */
const CENTERED_SQUARE: Vec2[] = [
  { x: 5, z: -5 },
  { x: 5, z: 5 },
  { x: -5, z: 5 },
  { x: -5, z: -5 },
];
const SQUARE_HALF_WIDTH = 5;

describe('turnsFacing', () => {
  it('is 0 when facing +z, and 0.25 turn increments around the compass', () => {
    expect(turnsFacing({ x: 0, z: 1 })).toBeCloseTo(0, 9);
    expect(turnsFacing({ x: 1, z: 0 })).toBeCloseTo(0.25, 9);
    expect(turnsFacing({ x: 0, z: -1 })).toBeCloseTo(0.5, 9);
    expect(turnsFacing({ x: -1, z: 0 })).toBeCloseTo(-0.25, 9);
  });
});

describe('ringRadiusAt: centred square (simple case)', () => {
  it('reaches the half-width along the axis-aligned +x and +z directions', () => {
    expect(ringRadiusAt(CENTERED_SQUARE, { x: 0, z: 0 }, 0)).toBeCloseTo(SQUARE_HALF_WIDTH, 6); // +x
    expect(ringRadiusAt(CENTERED_SQUARE, { x: 0, z: 0 }, Math.PI / 2)).toBeCloseTo(SQUARE_HALF_WIDTH, 6); // +z
  });

  it('reaches the corner distance along the diagonal', () => {
    const cornerDistance = SQUARE_HALF_WIDTH * Math.SQRT2;
    expect(ringRadiusAt(CENTERED_SQUARE, { x: 0, z: 0 }, Math.PI / 4)).toBeCloseTo(cornerDistance, 6);
  });

  it('is unaffected by a non-zero centre (translation invariance)', () => {
    const center = { x: 40, z: -12 };
    const translated = CENTERED_SQUARE.map((p) => ({ x: p.x + center.x, z: p.z + center.z }));
    expect(ringRadiusAt(translated, center, 0)).toBeCloseTo(SQUARE_HALF_WIDTH, 6);
  });
});

function baseParams(overrides: Partial<CastleParams> = {}): CastleParams {
  return {
    center: { x: 100, z: 100 },
    radiusM: 40,
    towerCount: 5,
    approach: { x: 0, z: 1 }, // approach comes from the south (+z)
    baseHeightM: 10,
    wallHeightM: 9,
    wallThicknessM: 2.6,
    towerRadiusM: 4.2,
    towerHeightM: 15,
    gateOpeningM: 4.5,
    moatOffsetM: 11,
    moatWidthM: 9,
    moatDepthM: 2.2,
    idPrefix: 'test-',
    ...overrides,
  };
}

describe('planCastle: towers', () => {
  it('builds towerCount round curtain towers plus exactly 2 square gate towers', () => {
    const plan = planCastle(Rng.create('castle-towers-6'), baseParams({ towerCount: 6 }));
    expect(plan.towers.filter((t) => t.shape === 'round')).toHaveLength(6);
    expect(plan.towers.filter((t) => t.shape === 'square')).toHaveLength(2);
    expect(plan.towers).toHaveLength(8);
    expect(plan.ring).toHaveLength(6);
  });

  it('honours the minimum towerCount (3)', () => {
    const plan = planCastle(Rng.create('castle-towers-3'), baseParams({ towerCount: 3 }));
    expect(plan.towers.filter((t) => t.shape === 'round')).toHaveLength(3);
    expect(plan.towers.filter((t) => t.shape === 'square')).toHaveLength(2);
  });
});

describe('planCastle: gate', () => {
  it('places the gate at the midpoint of the last and first ring corners', () => {
    const plan = planCastle(Rng.create('castle-gate-mid'), baseParams());
    const a = plan.ring[plan.ring.length - 1] as Vec2;
    const b = plan.ring[0] as Vec2;
    expect(plan.gate.center.x).toBeCloseTo((a.x + b.x) / 2, 9);
    expect(plan.gate.center.z).toBeCloseTo((a.z + b.z) / 2, 9);
  });

  it('rotates the gate to face the approach direction (outward normal points towards it)', () => {
    const eastApproach = { x: 1, z: 0 };
    const plan = planCastle(Rng.create('castle-gate-east'), baseParams({ approach: eastApproach }));
    const rot = plan.gate.rotationTurns * 2 * Math.PI;
    const gateOut: Vec2 = { x: Math.sin(rot), z: Math.cos(rot) };
    // turnsFacing/rotation convention round-trips: the gate's outward normal should closely
    // match the approach direction it was built to face.
    expect(gateOut.x).toBeCloseTo(eastApproach.x, 1);
    expect(gateOut.z).toBeCloseTo(eastApproach.z, 1);
  });
});

describe('planCastle: moat', () => {
  it('is a closed loop (first point equals last point)', () => {
    const plan = planCastle(Rng.create('castle-moat-closed'), baseParams());
    const first = plan.moat.centerline[0] as Vec2;
    const last = plan.moat.centerline[plan.moat.centerline.length - 1] as Vec2;
    expect(first.x).toBeCloseTo(last.x, 6);
    expect(first.z).toBeCloseTo(last.z, 6);
  });

  it('sits at baseHeight - moatDepth', () => {
    const plan = planCastle(Rng.create('castle-moat-level'), baseParams({ baseHeightM: 20, moatDepthM: 3 }));
    expect(plan.moat.levelM).toBe(17);
  });
});

describe('planCastle: gateApproach', () => {
  it('lies outside the moat water body', () => {
    const plan = planCastle(Rng.create('castle-approach-outside'), baseParams());
    const distToMoatCenterline = projectOnPolyline(plan.gateApproach, plan.moat.centerline).distance;
    expect(distToMoatCenterline).toBeGreaterThan(plan.moat.widthM / 2);
  });
});

describe('planCastle: determinism', () => {
  it('the same rng seed and params produce an identical plan', () => {
    const a = planCastle(Rng.create('castle-determinism'), baseParams());
    const b = planCastle(Rng.create('castle-determinism'), baseParams());
    expect(a).toEqual(b);
  });
});
