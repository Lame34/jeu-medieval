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

export interface Bounds2 {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** Axis-aligned bounds of a point set, grown by `margin` (early-out for per-cell stamps). */
export function boundsOf(points: readonly Vec2[], margin: number): Bounds2 {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX: minX - margin, minZ: minZ - margin, maxX: maxX + margin, maxZ: maxZ + margin };
}

function inside(b: Bounds2 | undefined, x: number, z: number): boolean {
  return !b || (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
}

/** Writes heights at every corner from a function of world position. */
export function fillHeights(t: TerrainData, fn: HeightFn): void {
  for (let iz = 0; iz <= t.depth; iz++) {
    for (let ix = 0; ix <= t.width; ix++) t.heights[cornerIndex(t, ix, iz)] = fn(ix * t.cellSize, iz * t.cellSize);
  }
}

/** Blends corner heights towards `targetFn` with weight `weightFn` in [0, 1] (within `bounds`). */
export function blendHeights(t: TerrainData, weightFn: HeightFn, targetFn: HeightFn, bounds?: Bounds2): void {
  for (let iz = 0; iz <= t.depth; iz++) {
    for (let ix = 0; ix <= t.width; ix++) {
      const x = ix * t.cellSize;
      const z = iz * t.cellSize;
      if (!inside(bounds, x, z)) continue;
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
export function carveChannel(t: TerrainData, centerline: readonly Vec2[], halfWidthM: number, bankM: number, bedM: number | HeightFn): void {
  const bed = typeof bedM === 'number' ? () => bedM : bedM;
  blendHeights(
    t,
    (x, z) => 1 - smoothstep(halfWidthM * 0.55, halfWidthM + bankM, projectOnPolyline({ x, z }, centerline).distance),
    bed,
    boundsOf(centerline, halfWidthM + bankM),
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
    boundsOf(polygon, marginM),
  );
}

/** Smooths heights along a road so it follows the relief without bumps. */
export function smoothAlong(t: TerrainData, centerline: readonly Vec2[], radiusM: number, strength: number): void {
  const source = t.heights.slice();
  const bounds = boundsOf(centerline, radiusM);
  for (let iz = 1; iz < t.depth; iz++) {
    for (let ix = 1; ix < t.width; ix++) {
      const x = ix * t.cellSize;
      const z = iz * t.cellSize;
      if (!inside(bounds, x, z)) continue;
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

/** Paints a layer on every cell (within `bounds`) whose centre satisfies the predicate. */
export function paintCells(t: TerrainData, layer: TerrainLayerId, predicate: (center: Vec2, cx: number, cz: number) => boolean, bounds?: Bounds2): void {
  const cs = t.cellSize;
  const cx0 = bounds ? Math.max(0, Math.floor(bounds.minX / cs)) : 0;
  const cz0 = bounds ? Math.max(0, Math.floor(bounds.minZ / cs)) : 0;
  const cx1 = bounds ? Math.min(t.width - 1, Math.ceil(bounds.maxX / cs)) : t.width - 1;
  const cz1 = bounds ? Math.min(t.depth - 1, Math.ceil(bounds.maxZ / cs)) : t.depth - 1;
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const center = { x: (cx + 0.5) * cs, z: (cz + 0.5) * cs };
      if (predicate(center, cx, cz)) t.layers[cz * t.width + cx] = layer;
    }
  }
}

export function paintAlongPolyline(t: TerrainData, line: readonly Vec2[], halfWidthM: number, layer: TerrainLayerId, onlyOver?: readonly TerrainLayerId[]): void {
  paintCells(
    t,
    layer,
    (c, cx, cz) => {
      if (onlyOver && !onlyOver.includes(t.layers[cz * t.width + cx] as TerrainLayerId)) return false;
      return projectOnPolyline(c, line).distance <= halfWidthM;
    },
    boundsOf(line, halfWidthM),
  );
}

export function paintPolygon(t: TerrainData, polygon: readonly Vec2[], layer: TerrainLayerId, onlyOver?: readonly TerrainLayerId[]): void {
  paintCells(
    t,
    layer,
    (c, cx, cz) => (!onlyOver || onlyOver.includes(t.layers[cz * t.width + cx] as TerrainLayerId)) && pointInPolygon(c, polygon),
    boundsOf(polygon, 0),
  );
}

export function paintDisc(t: TerrainData, center: Vec2, radiusM: number, layer: TerrainLayerId): void {
  paintCells(t, layer, (c) => Math.hypot(c.x - center.x, c.z - center.z) <= radiusM, boundsOf([center], radiusM));
}

/** Layers that nothing else may overwrite once placed (structures and water). */
export const STRUCTURAL_LAYERS: readonly TerrainLayerId[] = [TerrainLayer.River, TerrainLayer.Moat, TerrainLayer.Wall, TerrainLayer.Building];
