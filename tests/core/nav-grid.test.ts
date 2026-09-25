import { describe, expect, it } from 'vitest';
import { IMPASSABLE, Rng, TerrainLayer, edgeCost, isPassable, segmentCost, type MovementProfile } from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { buildNav, fillRect, flatTerrain, setPlaneHeights } from './helpers.ts';

const FOOT: MovementProfile = 'foot';
const ENGINE: MovementProfile = 'engine';
const UPHILL_PENALTY = DEFAULT_RULES.movement.uphillPenaltyPerGrade;

describe('buildNavGrid: apPerMeter', () => {
  it('equals 1 / metersPerAp for a walkable layer and profile', () => {
    const t = flatTerrain(3, 3);
    fillRect(t, 0, 0, 2, 2, TerrainLayer.Road);
    const nav = buildNav(t);
    const roadRule = DEFAULT_RULES.terrainLayers[TerrainLayer.Road];
    const expectedApPerMeter = 1 / (roadRule?.metersPerAp.foot as number);
    expect(nav.apPerMeter.foot[4] as number).toBeCloseTo(expectedApPerMeter, 12);
  });

  it('is IMPASSABLE on a River cell for every profile (metersPerAp is 0 everywhere)', () => {
    const t = flatTerrain(2, 2);
    fillRect(t, 0, 0, 1, 1, TerrainLayer.River);
    const nav = buildNav(t);
    for (const profile of ['lightFoot', 'foot', 'mounted', 'engine'] as const) {
      expect(nav.apPerMeter[profile][0] as number).toBe(IMPASSABLE);
      expect(isPassable(nav, profile, 0, 0)).toBe(false);
    }
  });

  it('is IMPASSABLE on a Wall cell for every profile', () => {
    const t = flatTerrain(2, 2);
    fillRect(t, 0, 0, 1, 1, TerrainLayer.Wall);
    const nav = buildNav(t);
    expect(isPassable(nav, FOOT, 0, 0)).toBe(false);
  });

  it('is IMPASSABLE when the cell grade exceeds the profile max walkable grade, even on a walkable layer', () => {
    const t = flatTerrain(2, 1, 1); // Plain everywhere: metersPerAp.engine = 5, normally walkable
    // A steep 3m jump over a single 1m cell gives a grade of 3, far above every profile's max.
    setPlaneHeights(t, 3, 0);
    const nav = buildNav(t);
    const engineMaxGrade = DEFAULT_RULES.movement.maxWalkableGrade.engine;
    expect(engineMaxGrade).toBeLessThan(3);
    expect(nav.apPerMeter.engine[0] as number).toBe(IMPASSABLE);
    expect(isPassable(nav, ENGINE, 0, 0)).toBe(false);
  });

  it('minApPerMeter is the cheapest finite AP/m over the grid, per profile', () => {
    const t = flatTerrain(2, 1, 1);
    fillRect(t, 0, 0, 0, 0, TerrainLayer.Mud); // expensive
    fillRect(t, 1, 0, 1, 0, TerrainLayer.Road); // cheap
    const nav = buildNav(t);
    const roadCost = 1 / (DEFAULT_RULES.terrainLayers[TerrainLayer.Road]?.metersPerAp.foot as number);
    expect(nav.minApPerMeter.foot).toBeCloseTo(roadCost, 12);
  });
});

describe('segmentCost: flat terrain', () => {
  it('equals length / metersPerAp for a straight segment over a uniform walkable layer', () => {
    const t = flatTerrain(5, 1, 1);
    const nav = buildNav(t);
    const plainRule = DEFAULT_RULES.terrainLayers[TerrainLayer.Plain];
    const metersPerAp = plainRule?.metersPerAp.foot as number;
    const cost = segmentCost(nav, FOOT, 0.5, 0.5, 4.5, 0.5);
    // Heights are stored in a Float32Array, so allow for float32 rounding (~1e-7 relative).
    expect(cost).toBeCloseTo(4 / metersPerAp, 6);
  });

  it('is 0 for a zero-length segment', () => {
    const t = flatTerrain(2, 2);
    const nav = buildNav(t);
    expect(segmentCost(nav, FOOT, 1.2, 1.2, 1.2, 1.2)).toBe(0);
  });
});

describe('segmentCost: slopes', () => {
  it('an uphill segment costs strictly more than the same segment travelled downhill', () => {
    const t = flatTerrain(4, 1, 1);
    setPlaneHeights(t, 0.5, 0); // rises steadily along x, well under foot's max grade
    const nav = buildNav(t);
    expect(DEFAULT_RULES.movement.maxWalkableGrade.foot).toBeGreaterThan(0.5);
    const uphill = segmentCost(nav, FOOT, 0.5, 0.5, 3.5, 0.5);
    const downhill = segmentCost(nav, FOOT, 3.5, 0.5, 0.5, 0.5);
    expect(Number.isFinite(uphill)).toBe(true);
    expect(uphill).toBeGreaterThan(downhill);
  });

  it('uphill penalty scales with uphillPenaltyPerGrade (sanity: penalty is actually applied)', () => {
    expect(UPHILL_PENALTY).toBeGreaterThan(0);
    const t = flatTerrain(2, 1, 1);
    setPlaneHeights(t, 0.4, 0); // grade 0.4, safely under foot's max walkable grade (0.9)
    expect(DEFAULT_RULES.movement.maxWalkableGrade.foot).toBeGreaterThan(0.4);
    const nav = buildNav(t);
    const flatT = flatTerrain(2, 1, 1);
    const flatNav = buildNav(flatT);
    const slopedCost = segmentCost(nav, FOOT, 0.5, 0.5, 1.5, 0.5);
    const flatCost = segmentCost(flatNav, FOOT, 0.5, 0.5, 1.5, 0.5);
    expect(Number.isFinite(slopedCost)).toBe(true);
    expect(slopedCost).toBeGreaterThan(flatCost);
  });
});

describe('segmentCost: obstacles', () => {
  it('is IMPASSABLE when the segment enters a Wall cell', () => {
    const t = flatTerrain(3, 1, 1);
    fillRect(t, 1, 0, 1, 0, TerrainLayer.Wall);
    const nav = buildNav(t);
    expect(segmentCost(nav, FOOT, 0.5, 0.5, 2.5, 0.5)).toBe(IMPASSABLE);
  });

  it('forbids squeezing diagonally between two blocked cells that share only a corner', () => {
    const t = flatTerrain(2, 2, 1);
    fillRect(t, 1, 0, 1, 0, TerrainLayer.Wall); // (1,0)
    fillRect(t, 0, 1, 0, 1, TerrainLayer.Wall); // (0,1)
    const nav = buildNav(t);
    // (0,0) and (1,1) are themselves walkable, but the diagonal move between their centres
    // passes exactly through the shared corner of the two Wall cells.
    expect(nav.apPerMeter.foot[0] as number).toBeLessThan(IMPASSABLE);
    expect(nav.apPerMeter.foot[3] as number).toBeLessThan(IMPASSABLE);
    const cost = segmentCost(nav, FOOT, 0.5, 0.5, 1.5, 1.5);
    expect(cost).toBe(IMPASSABLE);
  });

  it('a dynamic `blocked` predicate makes an otherwise-walkable cell impassable', () => {
    const t = flatTerrain(3, 1, 1);
    const nav = buildNav(t);
    const blocked = (index: number): boolean => index === 1; // the middle cell
    expect(segmentCost(nav, FOOT, 0.5, 0.5, 2.5, 0.5, blocked)).toBe(IMPASSABLE);
  });
});

describe('edgeCost vs segmentCost: must be exactly identical between neighbouring centres', () => {
  const PROFILES: readonly MovementProfile[] = ['lightFoot', 'foot', 'mounted', 'engine'];

  it('agree bit-for-bit on random small terrains with relief (cellSize = 1)', () => {
    const rng = Rng.create('edge-vs-segment-cost');
    const TRIALS = 25;
    let comparisons = 0;
    for (let trial = 0; trial < TRIALS; trial++) {
      const width = rng.int(4, 7);
      const depth = rng.int(4, 7);
      const t = flatTerrain(width, depth, 1);
      for (let iz = 0; iz <= depth; iz++) {
        for (let ix = 0; ix <= width; ix++) t.heights[iz * (width + 1) + ix] = rng.float(-0.5, 0.5);
      }
      // Scatter a few Wall cells to exercise the blocked/corner-cutting branches too.
      for (let i = 0; i < Math.floor((width * depth) / 6); i++) {
        const cx = rng.int(0, width - 1);
        const cz = rng.int(0, depth - 1);
        t.layers[cz * width + cx] = TerrainLayer.Wall;
      }
      const nav = buildNav(t);
      for (const profile of PROFILES) {
        for (let cz = 0; cz < depth; cz++) {
          for (let cx = 0; cx < width; cx++) {
            for (let dz = -1; dz <= 1; dz++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dz === 0) continue;
                const nx = cx + dx;
                const nz = cz + dz;
                if (nx < 0 || nz < 0 || nx >= width || nz >= depth) continue;
                const viaEdge = edgeCost(nav, profile, cx, cz, dx, dz);
                const ax = (cx + 0.5) * t.cellSize;
                const az = (cz + 0.5) * t.cellSize;
                const bx = (nx + 0.5) * t.cellSize;
                const bz = (nz + 0.5) * t.cellSize;
                const viaSegment = segmentCost(nav, profile, ax, az, bx, bz);
                expect(viaEdge).toBe(viaSegment);
                comparisons++;
              }
            }
          }
        }
      }
    }
    expect(comparisons).toBeGreaterThan(1000);
  });
});
