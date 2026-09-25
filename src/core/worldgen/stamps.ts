/**
 * Terrain "stamps": deterministic operations that shape heights and paint navigation layers.
 * Composed by the look-dev and battle generators.
 */
import type { Vec2 } from '../math/vec2.ts';
import { smoothstep } from '../math/scalar.ts';
import type { TerrainLayerId } from '../rules/types.ts';
import { TerrainLayer } from '../rules/types.ts';
import { cornerIndex, type TerrainData } from '../terrain-data/terrain-data.ts';
import { pointInPolygon, projectOnPolyline } from './geometry.ts';

export type HeightFn = (x: number, z: number) => number;

/** Writes heights at every corner from a function of world position. */
export function fillHeights(t: TerrainData, fn: HeightFn): void {
  for (let iz = 0; iz <= t.depth; iz++) {
    for (let ix = 0; ix <= t.width; ix++) t.heights[cornerIndex(t, ix, iz)] = fn(ix * t.cellSize, iz * t.cellSize);
  }
}

/** Blends corner heights towards `targetFn` with weight `weightFn` in [0, 1]. */
export function blendHeights(t: TerrainData, weightFn: HeightFn, targetFn: HeightFn): void {
  for (let iz = 0; iz <= t.depth; iz++) {
    for (let ix = 0; ix <= t.width; ix++) {
      const x = ix * t.cellSize;
      const z = iz * t.cellSize;
      const w = weightFn(x, z);
      if (w <= 0) continue;
      const i = cornerIndex(t, ix, iz);
      const h = t.heights[i] as number;
      t.heights[i] = h + (targetFn(x, z) - h) * Math.min(1, w);
    }
  }
}

/**
 * Carves a river bed along a centreline: flat bottom at `bedM`, banks rising smoothly to the
 * surrounding terrain over `bankM` beyond the half width.
 */
export function carveChannel(t: TerrainData, centerline: readonly Vec2[], halfWidthM: number, bankM: number, bedM: number): void {
  blendHeights(
    t,
    (x, z) => 1 - smoothstep(halfWidthM * 0.55, halfWidthM + bankM, projectOnPolyline({ x, z }, centerline).distance),
    () => bedM,
  );
}

/** Flattens an area defined by a polygon (plus a soft margin) to a fixed height. */
export function flattenPolygon(t: TerrainData, polygon: readonly Vec2[], heightM: number, marginM: number): void {
  const closed = [...polygon, polygon[0] as Vec2];
  blendHeights(
    t,
    (x, z) => {
      const p = { x, z };
      if (pointInPolygon(p, polygon)) return 1;
      return 1 - smoothstep(0, marginM, projectOnPolyline(p, closed).distance);
    },
    () => heightM,
  );
}

/** Smooths heights along a road so it follows the relief without bumps. */
export function smoothAlong(t: TerrainData, centerline: readonly Vec2[], radiusM: number, strength: number): void {
  const source = t.heights.slice();
  for (let iz = 1; iz < t.depth; iz++) {
    for (let ix = 1; ix < t.width; ix++) {
      const x = ix * t.cellSize;
      const z = iz * t.cellSize;
      const d = projectOnPolyline({ x, z }, centerline).distance;
      if (d > radiusM) continue;
      let sum = 0;
      let n = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const jx = Math.min(t.width, Math.max(0, ix + dx));
          const jz = Math.min(t.depth, Math.max(0, iz + dz));
          sum += source[cornerIndex(t, jx, jz)] as number;
          n++;
        }
      }
      const i = cornerIndex(t, ix, iz);
      const w = strength * (1 - smoothstep(radiusM * 0.5, radiusM, d));
      t.heights[i] = (source[i] as number) * (1 - w) + (sum / n) * w;
    }
  }
}

/** Paints a layer on every cell whose centre satisfies the predicate. */
export function paintCells(t: TerrainData, layer: TerrainLayerId, predicate: (center: Vec2, cx: number, cz: number) => boolean): void {
  for (let cz = 0; cz < t.depth; cz++) {
    for (let cx = 0; cx < t.width; cx++) {
      const center = { x: (cx + 0.5) * t.cellSize, z: (cz + 0.5) * t.cellSize };
      if (predicate(center, cx, cz)) t.layers[cz * t.width + cx] = layer;
    }
  }
}

export function paintAlongPolyline(t: TerrainData, line: readonly Vec2[], halfWidthM: number, layer: TerrainLayerId, onlyOver?: readonly TerrainLayerId[]): void {
  paintCells(t, layer, (c, cx, cz) => {
    if (onlyOver && !onlyOver.includes(t.layers[cz * t.width + cx] as TerrainLayerId)) return false;
    return projectOnPolyline(c, line).distance <= halfWidthM;
  });
}

export function paintPolygon(t: TerrainData, polygon: readonly Vec2[], layer: TerrainLayerId): void {
  paintCells(t, layer, (c) => pointInPolygon(c, polygon));
}

export function paintDisc(t: TerrainData, center: Vec2, radiusM: number, layer: TerrainLayerId): void {
  paintCells(t, layer, (c) => Math.hypot(c.x - center.x, c.z - center.z) <= radiusM);
}

/** Layers that nothing else may overwrite once placed (structures and water). */
export const STRUCTURAL_LAYERS: readonly TerrainLayerId[] = [TerrainLayer.River, TerrainLayer.Moat, TerrainLayer.Wall, TerrainLayer.Building];
