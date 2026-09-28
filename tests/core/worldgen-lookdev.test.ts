/**
 * Behavioural checks for src/core/worldgen/lookdev.ts and the `UnitMarker.elevationM` field
 * (src/core/worldgen/types.ts): the wall-walk guard's elevated position, the fixed 2-vs-2 unit
 * roster, hedgerow standards and ecotone saplings, the no-bush-on-the-road-verge rule, and
 * determinism end to end. Complements the shape/determinism checks already in worldgen.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { projectOnPolyline } from '@core/worldgen/geometry.ts';
import { generateLookdev } from '@core/worldgen/lookdev.ts';
import type { Vec2 } from '@core/math/vec2.ts';

// A handful of fixed seeds, named for what they exercise below (never Math.random).
const SEED_PRIMARY = 'lookdev-extra-a';
const SEED_SECONDARY = 'lookdev-extra-b';
const SEED_TERTIARY = 'lookdev-extra-c';
const SEEDS = [SEED_PRIMARY, SEED_SECONDARY, SEED_TERTIARY] as const;

// lookdev.ts: `underSpots` gates bush/fern density with
// `smoothstep(PATH.widthM/2 + 3, PATH.widthM/2 + 4, pathD)`, which is exactly 0 (so no candidate
// is ever kept, see poissonScatter) for any distance below `widthM/2 + 3`. The -0.01 below is
// slack for floating-point round-trip only, not a rule relaxation.
const ROAD_BUSH_CLEARANCE_M = 3;
const ROAD_BUSH_TOLERANCE_M = 0.01;

// lookdev.ts: hedgerow standards are placed exactly on the hedge polyline (`pointAlong`), so the
// projected distance back onto it is 0 up to floating-point error.
const ON_POLYLINE_TOLERANCE_M = 1e-6;

// lookdev.ts: ecotone saplings (`ecotone` scatter) use `vegRng.float(0.5, 0.8)`.
const ECOTONE_MAX_SCALE = 0.8;

describe('generateLookdev: UnitMarker.elevationM and the fixed unit roster', () => {
  it('always places exactly 4 units, 2 attackers and 2 defenders', () => {
    for (const seed of SEEDS) {
      const layout = generateLookdev(seed);
      expect(layout.units).toHaveLength(4);
      expect(layout.units.filter((u) => u.faction === 'attacker')).toHaveLength(2);
      expect(layout.units.filter((u) => u.faction === 'defender')).toHaveLength(2);
    }
  });

  it('elevationM is optional: only the wall-walk guard (def-1) carries it', () => {
    const layout = generateLookdev(SEED_PRIMARY);
    const byId = new Map(layout.units.map((u) => [u.id, u]));
    expect(byId.get('att-1')?.elevationM).toBeUndefined();
    expect(byId.get('att-2')?.elevationM).toBeUndefined();
    expect(byId.get('def-2')?.elevationM).toBeUndefined();
    expect(byId.get('def-1')?.elevationM).toBeTypeOf('number');
  });

  it("def-1's elevationM equals the wall's base height plus its height, at every seed", () => {
    for (const seed of SEEDS) {
      const layout = generateLookdev(seed);
      const guard = layout.units.find((u) => u.id === 'def-1');
      const wall = layout.walls[0];
      expect(wall).toBeDefined();
      expect(guard?.elevationM).toBeCloseTo((wall?.baseHeightM ?? NaN) + (wall?.heightM ?? NaN), 9);
    }
  });

  it("def-1 stands on the wall's western segment (its wall-walk, the tower at points[1])", () => {
    for (const seed of SEEDS) {
      const layout = generateLookdev(seed);
      const guard = layout.units.find((u) => u.id === 'def-1');
      const wall = layout.walls[0];
      const [, p0, p1] = wall?.points ?? [];
      expect(p0).toBeDefined();
      expect(p1).toBeDefined();
      const a = p0 as Vec2;
      const b = p1 as Vec2;
      expect(guard?.position.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x));
      expect(guard?.position.x).toBeLessThanOrEqual(Math.max(a.x, b.x));
      expect(guard?.position.z).toBeGreaterThanOrEqual(Math.min(a.z, b.z));
      expect(guard?.position.z).toBeLessThanOrEqual(Math.max(a.z, b.z));
    }
  });
});

describe('generateLookdev: vegetation dressing', () => {
  it('plants oak standards along hedges[0] (the field-edge hedge, not the dry-stone wall)', () => {
    for (const seed of SEEDS) {
      const layout = generateLookdev(seed);
      const hedge = layout.hedges[0];
      expect(hedge?.kind).toBe('hedge');
      const hedgerowOaks = layout.trees.filter(
        (tr) => tr.species === 'oak' && projectOnPolyline(tr.position, hedge?.points ?? []).distance < ON_POLYLINE_TOLERANCE_M,
      );
      expect(hedgerowOaks.length).toBeGreaterThan(0);
    }
  });

  it('scatters young ecotone saplings (oak/birch, scale <= 0.8) softening the forest edge', () => {
    for (const seed of SEEDS) {
      const layout = generateLookdev(seed);
      const saplings = layout.trees.filter((tr) => (tr.species === 'oak' || tr.species === 'birch') && tr.scale <= ECOTONE_MAX_SCALE);
      expect(saplings.length).toBeGreaterThan(0);
    }
  });

  it('never plants a bush within 3m of the path verge (half-width included)', () => {
    for (const seed of SEEDS) {
      const layout = generateLookdev(seed);
      const road = layout.roads[0];
      expect(road).toBeDefined();
      const bushes = layout.trees.filter((tr) => tr.species === 'bush');
      expect(bushes.length).toBeGreaterThan(0); // otherwise the check below would be vacuous
      const minAllowed = (road?.widthM ?? 0) / 2 + ROAD_BUSH_CLEARANCE_M - ROAD_BUSH_TOLERANCE_M;
      for (const bush of bushes) {
        const distance = projectOnPolyline(bush.position, road?.centerline ?? []).distance;
        expect(distance).toBeGreaterThanOrEqual(minAllowed);
      }
    }
  });
});

describe('generateLookdev: determinism of the new fields', () => {
  it('elevationM and the unit roster are bit-for-bit identical for a fixed seed', () => {
    const a = generateLookdev(SEED_PRIMARY);
    const b = generateLookdev(SEED_PRIMARY);
    expect(a.units).toEqual(b.units);
    expect(a.units.find((u) => u.id === 'def-1')?.elevationM).toBe(b.units.find((u) => u.id === 'def-1')?.elevationM);
  });

  it('is stable across a JSON round-trip (as a replayed scenario payload would be)', () => {
    const layout = generateLookdev(SEED_PRIMARY);
    const roundTripped = JSON.parse(JSON.stringify(layout.units)) as typeof layout.units;
    expect(roundTripped).toEqual(layout.units);
  });
});
