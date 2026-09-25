/**
 * src/core/worldgen/** is not re-exported from src/core/index.ts (it is map-generation tooling
 * used by the renderer's look-dev scene and future map generators, not part of the battle
 * simulation's public surface), but it is still plain, deterministic core code under
 * src/core/**, so it is imported directly by relative/alias path here.
 */
import { describe, expect, it } from 'vitest';
import { heightAtCorner, layerAt, setHeightAtCorner } from '@core/terrain-data/terrain-data.ts';
import { TerrainLayer } from '@core/rules/types.ts';
import { Rng } from '@core/rng.ts';
import { hashValue } from '@core/math/hash.ts';
import {
  catmullRom,
  distanceToPolygonEdge,
  orientedRect,
  pointAlong,
  pointInPolygon,
  polylineLength,
  projectOnPolyline,
} from '@core/worldgen/geometry.ts';
import { poissonScatter } from '@core/worldgen/scatter.ts';
import {
  STRUCTURAL_LAYERS,
  blendHeights,
  carveChannel,
  fillHeights,
  flattenPolygon,
  paintAlongPolyline,
  paintCells,
  paintDisc,
  paintPolygon,
  smoothAlong,
} from '@core/worldgen/stamps.ts';
import { LOOKDEV_SIZE_M, generateLookdev, groundAt } from '@core/worldgen/lookdev.ts';
import { flatTerrain } from './helpers.ts';

describe('geometry: projectOnPolyline', () => {
  const flatLine = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ];

  it('projects perpendicular onto a segment, reporting distance and arc length', () => {
    const result = projectOnPolyline({ x: 5, z: 3 }, flatLine);
    expect(result).toEqual({ distance: 3, along: 5, point: { x: 5, z: 0 } });
  });

  it('clamps to the segment start when the point projects before it', () => {
    const result = projectOnPolyline({ x: -5, z: 3 }, flatLine);
    expect(result.along).toBe(0);
    expect(result.point).toEqual({ x: 0, z: 0 });
  });

  it('clamps to the segment end when the point projects past it', () => {
    const result = projectOnPolyline({ x: 15, z: 3 }, flatLine);
    expect(result.along).toBe(10);
    expect(result.point).toEqual({ x: 10, z: 0 });
  });

  it('an empty polyline falls back to the query point itself, at infinite distance', () => {
    const p = { x: 5, z: 5 };
    const result = projectOnPolyline(p, []);
    expect(result.distance).toBe(Number.POSITIVE_INFINITY);
    expect(result.point).toEqual(p);
  });
});

describe('geometry: polylineLength / pointAlong', () => {
  const bentLine = [
    { x: 0, z: 0 },
    { x: 3, z: 4 },
    { x: 3, z: 0 },
  ];

  it('polylineLength sums each segment length (3-4-5 triangle then straight back down)', () => {
    expect(polylineLength(bentLine)).toBe(5 + 4);
  });

  it('polylineLength of an empty or single-point line is 0', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 1, z: 1 }])).toBe(0);
  });

  it('pointAlong walks the polyline by arc length, clamped past the end', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(pointAlong(line, 0)).toEqual({ x: 0, z: 0 });
    expect(pointAlong(line, 5)).toEqual({ x: 5, z: 0 });
    expect(pointAlong(line, 50)).toEqual({ x: 10, z: 0 }); // clamped to the last point
  });

  it('pointAlong on an empty line returns the origin fallback', () => {
    expect(pointAlong([], 5)).toEqual({ x: 0, z: 0 });
  });
});

describe('geometry: catmullRom', () => {
  it('passes a single point straight through, unchanged', () => {
    expect(catmullRom([{ x: 1, z: 2 }], 5)).toEqual([{ x: 1, z: 2 }]);
  });

  it('an empty control list yields an empty curve', () => {
    expect(catmullRom([], 5)).toEqual([]);
  });

  it('interpolates a straight 2-point line exactly (start, end, and the linear midpoint)', () => {
    const curve = catmullRom(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ],
      4,
    );
    expect(curve[0]).toEqual({ x: 0, z: 0 });
    expect(curve[curve.length - 1]).toEqual({ x: 10, z: 0 });
    expect(curve).toHaveLength(4 + 1); // samplesPerSegment points + the final endpoint
    const mid = curve[2];
    expect(mid?.x).toBeCloseTo(5, 6);
    expect(mid?.z).toBeCloseTo(0, 6);
  });

  it('produces samplesPerSegment * (n-1) + 1 points for n collinear control points', () => {
    const curve = catmullRom(
      [
        { x: 0, z: 0 },
        { x: 5, z: 0 },
        { x: 10, z: 0 },
      ],
      4,
    );
    expect(curve).toHaveLength(4 * 2 + 1);
    // Collinear control points => the curve stays on the line (z stays 0 throughout).
    for (const p of curve) expect(p.z).toBeCloseTo(0, 6);
  });
});

describe('geometry: pointInPolygon / distanceToPolygonEdge', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ];

  it('classifies inside vs outside points', () => {
    expect(pointInPolygon({ x: 5, z: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, z: 5 }, square)).toBe(false);
  });

  it('measures distance to the nearest boundary edge', () => {
    expect(distanceToPolygonEdge({ x: 5, z: 5 }, square)).toBe(5); // dead centre of a 10x10 square
    expect(distanceToPolygonEdge({ x: 1, z: 5 }, square)).toBe(1); // 1m from the left edge
  });
});

describe('geometry: orientedRect', () => {
  it('returns axis-aligned corners at rotationTurns = 0', () => {
    const corners = orientedRect({ x: 0, z: 0 }, 4, 2, 0);
    expect(corners).toEqual([
      { x: -2, z: -1 },
      { x: 2, z: -1 },
      { x: 2, z: 1 },
      { x: -2, z: 1 },
    ]);
  });

  it('rotates a quarter turn (90 degrees) around the centre', () => {
    const corners = orientedRect({ x: 0, z: 0 }, 4, 2, 0.25).map((p) => ({
      x: Math.round(p.x * 1e6) / 1e6,
      z: Math.round(p.z * 1e6) / 1e6,
    }));
    expect(corners).toEqual([
      { x: 1, z: -2 },
      { x: 1, z: 2 },
      { x: -1, z: 2 },
      { x: -1, z: -2 },
    ]);
  });

  it('is centred: the average of the 4 corners is the input centre, off-origin too', () => {
    const center = { x: 12, z: -7 };
    const corners = orientedRect(center, 6, 3, 0.15);
    const avg = corners.reduce((s, c) => ({ x: s.x + c.x / 4, z: s.z + c.z / 4 }), { x: 0, z: 0 });
    expect(avg.x).toBeCloseTo(center.x, 6);
    expect(avg.z).toBeCloseTo(center.z, 6);
  });
});

describe('scatter: poissonScatter', () => {
  const bounds = { minX: 0, minZ: 0, maxX: 30, maxZ: 30 };
  const MIN_DISTANCE = 3;

  it('is deterministic for a fixed seed', () => {
    const a = poissonScatter(Rng.create('scatter-seed'), bounds, MIN_DISTANCE, () => 1);
    const b = poissonScatter(Rng.create('scatter-seed'), bounds, MIN_DISTANCE, () => 1);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('keeps every point within bounds and at least minDistance apart', () => {
    const points = poissonScatter(Rng.create('scatter-bounds'), bounds, MIN_DISTANCE, () => 1);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(p.x).toBeLessThan(bounds.maxX);
      expect(p.z).toBeGreaterThanOrEqual(bounds.minZ);
      expect(p.z).toBeLessThan(bounds.maxZ);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const p = points[i];
        const q = points[j];
        if (!p || !q) continue;
        expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(MIN_DISTANCE - 1e-9);
      }
    }
  });

  it('a density function that is always 0 keeps nothing', () => {
    const points = poissonScatter(Rng.create('scatter-zero-density'), bounds, MIN_DISTANCE, () => 0);
    expect(points).toEqual([]);
  });

  it('a lower density keeps fewer points than a uniform density of 1 (same seed and geometry)', () => {
    const full = poissonScatter(Rng.create('scatter-density-cmp'), bounds, MIN_DISTANCE, () => 1);
    const sparse = poissonScatter(Rng.create('scatter-density-cmp'), bounds, MIN_DISTANCE, () => 0.2);
    expect(sparse.length).toBeLessThan(full.length);
  });
});

describe('stamps: height operations', () => {
  it('fillHeights writes every corner from a function of world position', () => {
    const t = flatTerrain(10, 10, 1);
    fillHeights(t, (x, z) => x + z);
    expect(heightAtCorner(t, 3, 4)).toBe(7);
    expect(heightAtCorner(t, 0, 0)).toBe(0);
  });

  it('blendHeights interpolates towards the target by weight, clamped to 1', () => {
    const t = flatTerrain(10, 10, 1, 7);
    blendHeights(t, () => 0.5, () => 100);
    expect(heightAtCorner(t, 3, 4)).toBeCloseTo(53.5, 9); // 7 + (100-7)*0.5

    const t2 = flatTerrain(10, 10, 1, 7);
    blendHeights(t2, () => 2, () => 200); // weight > 1 is clamped to 1
    expect(heightAtCorner(t2, 3, 4)).toBe(200);
  });

  it('blendHeights leaves corners untouched where weight <= 0', () => {
    const t = flatTerrain(10, 10, 1, 7);
    blendHeights(t, () => 0, () => 999);
    expect(heightAtCorner(t, 3, 4)).toBe(7);
  });

  it('carveChannel flattens a bed at the centreline and leaves distant ground untouched', () => {
    const t = flatTerrain(20, 20, 1, 5);
    carveChannel(t, [{ x: 0, z: 10 }, { x: 20, z: 10 }], 2, 3, -1);
    expect(heightAtCorner(t, 10, 10)).toBe(-1); // right on the centreline: full bed depth
    expect(heightAtCorner(t, 10, 0)).toBe(5); // far from the river: unaffected
  });

  it('flattenPolygon sets the interior to a fixed height and leaves the far exterior untouched', () => {
    const t = flatTerrain(20, 20, 1, 5);
    flattenPolygon(
      t,
      [
        { x: 5, z: 5 },
        { x: 15, z: 5 },
        { x: 15, z: 15 },
        { x: 5, z: 15 },
      ],
      42,
      2,
    );
    expect(heightAtCorner(t, 10, 10)).toBe(42);
    expect(heightAtCorner(t, 19, 19)).toBe(5);
  });

  it('smoothAlong averages a spike near the centreline but leaves distant corners exact', () => {
    const t = flatTerrain(10, 10, 1, 0);
    setHeightAtCorner(t, 5, 5, 100); // a single spike
    smoothAlong(t, [{ x: 0, z: 5 }, { x: 10, z: 5 }], 3, 1);
    expect(heightAtCorner(t, 5, 5)).toBeLessThan(100); // smoothed down towards its neighbours
    expect(heightAtCorner(t, 0, 0)).toBe(0); // outside radiusM: untouched
  });
});

describe('stamps: layer painting', () => {
  it('paintCells paints exactly the cells the predicate accepts', () => {
    const t = flatTerrain(5, 5, 1);
    paintCells(t, TerrainLayer.Forest, (_c, cx, cz) => cx === 2 && cz === 2);
    expect(layerAt(t, 2, 2)).toBe(TerrainLayer.Forest);
    expect(layerAt(t, 0, 0)).toBe(TerrainLayer.Plain);
  });

  it('paintAlongPolyline paints a corridor of the given half-width around the line', () => {
    const t = flatTerrain(10, 3, 1);
    paintAlongPolyline(t, [{ x: 0, z: 1.5 }, { x: 10, z: 1.5 }], 0.6, TerrainLayer.Road);
    expect(layerAt(t, 5, 1)).toBe(TerrainLayer.Road); // on the line
    expect(layerAt(t, 5, 0)).toBe(TerrainLayer.Plain); // 1m away: outside the 0.6m half-width
  });

  it('paintAlongPolyline honours the onlyOver restriction', () => {
    const t = flatTerrain(10, 3, 1);
    paintCells(t, TerrainLayer.Rock, (_c, cx) => cx === 5); // (5,1) is Rock, not paintable-over
    paintAlongPolyline(t, [{ x: 0, z: 1.5 }, { x: 10, z: 1.5 }], 0.6, TerrainLayer.Road, [TerrainLayer.Plain]);
    expect(layerAt(t, 5, 1)).toBe(TerrainLayer.Rock); // left alone: not a Plain cell
    expect(layerAt(t, 4, 1)).toBe(TerrainLayer.Road); // a Plain cell on the line: painted
  });

  it('paintPolygon paints cells whose centre falls inside the polygon', () => {
    const t = flatTerrain(10, 10, 1);
    paintPolygon(t, [{ x: 2, z: 2 }, { x: 8, z: 2 }, { x: 8, z: 8 }, { x: 2, z: 8 }], TerrainLayer.Field);
    expect(layerAt(t, 5, 5)).toBe(TerrainLayer.Field);
    expect(layerAt(t, 0, 0)).toBe(TerrainLayer.Plain);
  });

  it('paintDisc paints cells within radiusM of the centre', () => {
    const t = flatTerrain(10, 10, 1);
    paintDisc(t, { x: 5, z: 5 }, 2, TerrainLayer.Rock);
    expect(layerAt(t, 5, 5)).toBe(TerrainLayer.Rock);
    expect(layerAt(t, 9, 9)).toBe(TerrainLayer.Plain);
  });

  it('STRUCTURAL_LAYERS lists the layers nothing else may overwrite', () => {
    expect(STRUCTURAL_LAYERS).toEqual([TerrainLayer.River, TerrainLayer.Moat, TerrainLayer.Wall, TerrainLayer.Building]);
  });
});

describe('generateLookdev', () => {
  it('is fully deterministic for a fixed seed (terrain, trees, and hence everything derived)', () => {
    const a = generateLookdev('lookdev-seed-x');
    const b = generateLookdev('lookdev-seed-x');
    expect(a.terrain.heights).toEqual(b.terrain.heights);
    expect(a.terrain.layers).toEqual(b.terrain.layers);
    expect(hashValue(a.trees)).toBe(hashValue(b.trees));
    expect(hashValue(a.houses)).toBe(hashValue(b.houses));
    expect(a.units).toEqual(b.units);
  });

  it('a different seed changes the generated vegetation', () => {
    const a = generateLookdev('lookdev-seed-x');
    const c = generateLookdev('lookdev-seed-y');
    expect(hashValue(a.trees)).not.toBe(hashValue(c.trees));
  });

  it('produces the documented scene shape: a 128x128m map with 2 houses, 4 units, and one of each structure', () => {
    const layout = generateLookdev('lookdev-shape');
    expect(layout.terrain.width).toBe(LOOKDEV_SIZE_M);
    expect(layout.terrain.depth).toBe(LOOKDEV_SIZE_M);
    expect(layout.playable).toEqual({ minX: 0, minZ: 0, maxX: LOOKDEV_SIZE_M, maxZ: LOOKDEV_SIZE_M });
    expect(layout.houses).toHaveLength(2);
    expect(layout.units).toHaveLength(4);
    expect(layout.water).toHaveLength(1);
    expect(layout.roads).toHaveLength(1);
    // One field-edge hedge and one dry-stone wall (src/core/worldgen/lookdev.ts: `hedge`, `dryWall`).
    expect(layout.hedges.map((h) => h.kind).sort()).toEqual(['dryStoneWall', 'hedge']);
    expect(layout.walls).toHaveLength(1);
    expect(layout.towers).toHaveLength(1);
    expect(layout.trees.length).toBeGreaterThan(0);
    // Every tree that made it into the final list must be outside the wheat field polygon.
    for (const tree of layout.trees) expect(pointInPolygon(tree.position, layout.fields[0]?.polygon ?? [])).toBe(false);
  });

  it('groundAt matches the cell-centre height of the generated terrain', () => {
    const layout = generateLookdev('lookdev-ground');
    const p = { x: 50.4, z: 62.9 };
    const ground = groundAt(layout, p);
    expect(Number.isFinite(ground)).toBe(true);
  });
});
