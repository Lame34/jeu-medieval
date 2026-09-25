/** src/core/worldgen/fields.ts: Voronoi field parcels, pure and fast. */
import { describe, expect, it } from 'vitest';
import { buildParcels, polygonArea, polygonCentroid, voronoiCell, type ParcelOptions } from '@core/worldgen/fields.ts';
import { pointInPolygon } from '@core/worldgen/geometry.ts';
import type { Vec2 } from '@core/math/vec2.ts';
import { Rng } from '@core/rng.ts';

describe('polygonArea', () => {
  it('a 10x10 axis-aligned square has area 100', () => {
    const square: Vec2[] = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
    expect(polygonArea(square)).toBe(100);
  });

  it('a right triangle (legs 4 and 3) has area 6', () => {
    const triangle: Vec2[] = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 0, z: 3 },
    ];
    expect(polygonArea(triangle)).toBe(6);
  });

  it('is winding-order independent (reversed square has the same area)', () => {
    const square: Vec2[] = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
    expect(polygonArea([...square].reverse())).toBe(polygonArea(square));
  });
});

describe('polygonCentroid', () => {
  it('a square centred on (5, 5) has centroid (5, 5)', () => {
    const square: Vec2[] = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ];
    expect(polygonCentroid(square)).toEqual({ x: 5, z: 5 });
  });

  it('a triangle centroid is the mean of its 3 vertices', () => {
    const triangle: Vec2[] = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 0, z: 3 },
    ];
    const c = polygonCentroid(triangle);
    expect(c.x).toBeCloseTo(4 / 3, 9);
    expect(c.z).toBeCloseTo(1, 9);
  });
});

const CELL_OPTIONS: ParcelOptions = { maxCellRadiusM: 30, insetM: 2, minAreaM2: 1 };

describe('voronoiCell', () => {
  // Three seeds, all 20m apart, so each cell's Voronoi border sits at half that distance (10m)
  // minus the 2m inset -> border at 8m from the seed along the direction to a neighbour.
  const seeds: Vec2[] = [
    { x: 50, z: 50 },
    { x: 70, z: 50 }, // 20m to the east of seed 0
    { x: 50, z: 70 }, // 20m to the south of seed 0
  ];

  it("contains its own seed", () => {
    const cell0 = voronoiCell(seeds, 0, CELL_OPTIONS);
    expect(pointInPolygon(seeds[0] as Vec2, cell0)).toBe(true);
  });

  it('does not contain a neighbouring seed', () => {
    const cell0 = voronoiCell(seeds, 0, CELL_OPTIONS);
    expect(pointInPolygon(seeds[1] as Vec2, cell0)).toBe(false);
    expect(pointInPolygon(seeds[2] as Vec2, cell0)).toBe(false);
  });

  it('respects the inset: no vertex crosses the midpoint minus insetM towards a neighbour', () => {
    const cell0 = voronoiCell(seeds, 0, CELL_OPTIONS);
    const halfDistanceToEastNeighbour = 10; // (70 - 50) / 2
    const expectedBorderX = halfDistanceToEastNeighbour - CELL_OPTIONS.insetM; // 8
    for (const p of cell0) expect(p.x).toBeLessThanOrEqual(50 + expectedBorderX + 1e-9);
  });
});

describe('buildParcels', () => {
  const seeds: Vec2[] = [
    { x: 20, z: 20 },
    { x: 40, z: 20 },
    { x: 20, z: 40 },
    { x: 40, z: 40 },
  ];
  const options: ParcelOptions = { maxCellRadiusM: 15, insetM: 1, minAreaM2: 1 };
  const acceptAll = (): boolean => true;

  it('is deterministic for a fixed rng seed', () => {
    const a = buildParcels(Rng.create('parcels-determinism'), seeds, options, acceptAll, 'f-');
    const b = buildParcels(Rng.create('parcels-determinism'), seeds, options, acceptAll, 'f-');
    expect(a).toEqual(b);
  });

  it('builds one field per accepted seed, and generates at least one hedge across several fields', () => {
    const result = buildParcels(Rng.create('parcels-basic'), seeds, options, acceptAll, 'f-');
    expect(result.fields).toHaveLength(seeds.length);
    expect(result.hedges.length).toBeGreaterThan(0);
  });

  it("the accept filter drops parcels it rejects, by seed index", () => {
    // Reject the parcel seeded at (40, 20) specifically (index 1), accept everything else.
    const rejected = seeds[1] as Vec2;
    const accept = (poly: readonly Vec2[]): boolean => !pointInPolygon(rejected, poly);
    const result = buildParcels(Rng.create('parcels-accept-filter'), seeds, options, accept, 'f-');
    expect(result.fields).toHaveLength(seeds.length - 1);
    expect(result.fields.some((f) => pointInPolygon(rejected, f.polygon))).toBe(false);
  });

  it('rejects a parcel smaller than minAreaM2', () => {
    // A single, far-away seed with a tiny maxCellRadiusM produces a small square below the
    // (deliberately huge) minAreaM2 threshold, so it must be dropped.
    const lonely: Vec2[] = [{ x: 0, z: 0 }];
    const tinyOptions: ParcelOptions = { maxCellRadiusM: 2, insetM: 0, minAreaM2: 1000 };
    const result = buildParcels(Rng.create('parcels-too-small'), lonely, tinyOptions, acceptAll, 'f-');
    expect(result.fields).toHaveLength(0);
  });
});
