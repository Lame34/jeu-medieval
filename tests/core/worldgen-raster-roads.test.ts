/**
 * src/core/worldgen/raster.ts (CellMask), roads.ts (routeRoad) and the remaining, not-yet-covered
 * corners of stamps.ts (boundsOf, carveChannel with a bed function, paintPolygon's onlyOver,
 * blendHeights' bounds). All fast: small terrains, no full map generation.
 */
import { describe, expect, it } from 'vitest';
import { CellMask } from '@core/worldgen/raster.ts';
import { routeRoad, type RoadCostOptions } from '@core/worldgen/roads.ts';
import { boundsOf, blendHeights, carveChannel, paintPolygon } from '@core/worldgen/stamps.ts';
import { TerrainLayer } from '@core/rules/types.ts';
import { heightAtCorner, layerAt, setLayer } from '@core/terrain-data/terrain-data.ts';
import type { Vec2 } from '@core/math/vec2.ts';
import { flatTerrain } from './helpers.ts';

describe('CellMask: markDisc', () => {
  it('marks cells within the radius and leaves cells outside it clear', () => {
    const mask = new CellMask(10, 10);
    mask.markDisc({ x: 5, z: 5 }, 2);
    expect(mask.get(5, 5)).toBe(true);
    expect(mask.get(9, 9)).toBe(false);
  });
});

describe('CellMask: markPolyline', () => {
  it('marks a corridor of the given radius around the line, nothing further away', () => {
    const mask = new CellMask(10, 5);
    mask.markPolyline([{ x: 0, z: 2.5 }, { x: 10, z: 2.5 }], 0.6);
    expect(mask.get(5, 2)).toBe(true); // on the line
    expect(mask.get(5, 0)).toBe(false); // 2m away: outside the 0.6m radius
  });
});

describe('CellMask: markPolygon', () => {
  it('marks the interior, and extends by marginM when given one', () => {
    const mask = new CellMask(10, 10);
    const square: Vec2[] = [
      { x: 3, z: 3 },
      { x: 7, z: 3 },
      { x: 7, z: 7 },
      { x: 3, z: 7 },
    ];
    mask.markPolygon(square);
    expect(mask.get(5, 5)).toBe(true); // interior
    expect(mask.get(8, 5)).toBe(false); // outside, no margin requested

    const maskWithMargin = new CellMask(10, 10);
    maskWithMargin.markPolygon(square, 2);
    expect(maskWithMargin.get(8, 5)).toBe(true); // within the 2m margin of the right edge
  });
});

describe('CellMask: markRect', () => {
  it('marks every cell whose centre falls in the rectangle', () => {
    const mask = new CellMask(10, 10);
    mask.markRect({ minX: 2, minZ: 2, maxX: 5, maxZ: 5 });
    expect(mask.get(3, 3)).toBe(true);
    expect(mask.get(8, 8)).toBe(false);
  });
});

describe('CellMask: out of bounds reads as blocked (true)', () => {
  it('get() returns true for any out-of-range cell coordinate', () => {
    const mask = new CellMask(4, 4);
    expect(mask.get(-1, 0)).toBe(true);
    expect(mask.get(0, -1)).toBe(true);
    expect(mask.get(4, 0)).toBe(true);
    expect(mask.get(0, 4)).toBe(true);
  });

  it('at() maps world coordinates outside the grid to true as well', () => {
    const mask = new CellMask(4, 4, 1);
    expect(mask.at({ x: 100, z: 100 })).toBe(true);
  });
});

describe('stamps: boundsOf', () => {
  it('is the axis-aligned bounding box of the points, grown by margin', () => {
    const points: Vec2[] = [
      { x: 2, z: 3 },
      { x: 5, z: -1 },
    ];
    expect(boundsOf(points, 1)).toEqual({ minX: 1, minZ: -2, maxX: 6, maxZ: 4 });
  });

  it('with margin 0 is exactly the tight bounding box', () => {
    const points: Vec2[] = [
      { x: -4, z: 10 },
      { x: 8, z: 2 },
    ];
    expect(boundsOf(points, 0)).toEqual({ minX: -4, minZ: 2, maxX: 8, maxZ: 10 });
  });
});

describe('stamps: carveChannel with a bed function', () => {
  it('sets the centreline height to bed(x, z) exactly, varying along the channel', () => {
    const t = flatTerrain(20, 20, 1, 5);
    const centerline: Vec2[] = [{ x: 0, z: 10 }, { x: 20, z: 10 }];
    const bed = (x: number, _z: number): number => x * 0.1; // slopes gently along the channel
    carveChannel(t, centerline, 2, 3, bed);
    expect(heightAtCorner(t, 10, 10)).toBeCloseTo(bed(10, 10), 6);
    expect(heightAtCorner(t, 4, 10)).toBeCloseTo(bed(4, 10), 6);
    expect(heightAtCorner(t, 10, 0)).toBe(5); // far from the channel: untouched
  });
});

describe('stamps: paintPolygon onlyOver', () => {
  it('only repaints cells whose current layer is in the onlyOver list', () => {
    const t = flatTerrain(10, 10, 1);
    setLayer(t, 5, 5, TerrainLayer.Road); // one cell inside the polygon is already Road
    const square: Vec2[] = [
      { x: 2, z: 2 },
      { x: 8, z: 2 },
      { x: 8, z: 8 },
      { x: 2, z: 8 },
    ];
    paintPolygon(t, square, TerrainLayer.Forest, [TerrainLayer.Plain]);
    expect(layerAt(t, 5, 5)).toBe(TerrainLayer.Road); // left alone: not a Plain cell
    expect(layerAt(t, 3, 3)).toBe(TerrainLayer.Forest); // was Plain: repainted
  });
});

describe('stamps: blendHeights with explicit bounds', () => {
  it('leaves corners outside bounds untouched even when weight/target would change them', () => {
    const t = flatTerrain(20, 20, 1, 7);
    blendHeights(t, () => 1, () => 100, { minX: 0, minZ: 0, maxX: 5, maxZ: 5 });
    expect(heightAtCorner(t, 3, 3)).toBe(100); // inside bounds: fully blended
    expect(heightAtCorner(t, 15, 15)).toBe(7); // outside bounds: untouched
  });
});

describe('roads: routeRoad', () => {
  const COST: RoadCostOptions = { stepM: 2, slopePenalty: 0, extraCost: () => 0 };

  it('the returned centreline starts and ends exactly at the requested endpoints', () => {
    const t = flatTerrain(20, 20, 1);
    const from: Vec2 = { x: 1, z: 1 };
    const to: Vec2 = { x: 18, z: 17 };
    const path = routeRoad(t, from, to, COST);
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual(from);
    expect(path?.[(path?.length ?? 1) - 1]).toEqual(to);
  });

  it('routes around a region of infinite extra cost instead of crossing it', () => {
    const t = flatTerrain(30, 12, 1);
    const from: Vec2 = { x: 2, z: 1 };
    const to: Vec2 = { x: 28, z: 1 };
    // A wall spanning x in [12, 18], solid except for a gap to the south (z >= 8). Because
    // `from` is west of the wall and `to` is east of it, any continuous route from one to the
    // other must cross that x-band somewhere, so it can only get through via the gap.
    const wallCost: RoadCostOptions = {
      stepM: 2,
      slopePenalty: 0,
      extraCost: (x: number, z: number) => (x >= 12 && x <= 18 && z < 8 ? Number.POSITIVE_INFINITY : 0),
    };
    const path = routeRoad(t, from, to, wallCost) as Vec2[];
    expect(path).not.toBeNull();
    // It must swing down towards the gap (curve smoothing may not touch z=8 exactly)...
    expect(path.some((p) => p.x > 10 && p.x < 20 && p.z >= 6)).toBe(true);
    // ...and never tunnel through the solid, deep-interior part of the wall.
    expect(path.some((p) => p.x > 12 && p.x < 18 && p.z < 3)).toBe(false);
  });

  it('returns null when the goal is completely enclosed by infinite-cost terrain', () => {
    const t = flatTerrain(20, 20, 1);
    const from: Vec2 = { x: 0, z: 0 };
    const to: Vec2 = { x: 18, z: 18 };
    // extraCost is evaluated at the neighbour being entered, so making it infinite exactly at
    // (and immediately around) the goal node makes the goal unreachable from every direction.
    const enclosingCost: RoadCostOptions = {
      stepM: 2,
      slopePenalty: 0,
      extraCost: (x: number, z: number) => (Math.hypot(x - to.x, z - to.z) <= COST.stepM + 0.001 ? Number.POSITIVE_INFINITY : 0),
    };
    expect(routeRoad(t, from, to, enclosingCost)).toBeNull();
  });
});
