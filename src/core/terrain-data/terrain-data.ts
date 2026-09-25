/**
 * Terrain data shared by simulation and rendering: a heightfield sampled at cell corners and
 * one navigation layer per cell. Cells are `cellSize` metres wide; cell (cx, cz) spans
 * [cx·cs, (cx+1)·cs) × [cz·cs, (cz+1)·cs) in world metres.
 */
import type { TerrainLayerId } from '../rules/types.ts';
import { TerrainLayer } from '../rules/types.ts';

export interface TerrainData {
  /** Number of cells along x. */
  readonly width: number;
  /** Number of cells along z. */
  readonly depth: number;
  readonly cellSize: number;
  /** (width + 1) × (depth + 1) corner heights, row-major (z rows of x samples). */
  readonly heights: Float32Array;
  /** width × depth layer ids, row-major. */
  readonly layers: Uint8Array;
}

export interface CellCoord {
  readonly cx: number;
  readonly cz: number;
}

export function createTerrainData(width: number, depth: number, cellSize = 1): TerrainData {
  if (!Number.isInteger(width) || !Number.isInteger(depth) || width <= 0 || depth <= 0) {
    throw new RangeError(`createTerrainData: invalid size ${width}×${depth}`);
  }
  if (!(cellSize > 0)) throw new RangeError('createTerrainData: cellSize must be > 0');
  return {
    width,
    depth,
    cellSize,
    heights: new Float32Array((width + 1) * (depth + 1)),
    layers: new Uint8Array(width * depth).fill(TerrainLayer.Plain),
  };
}

export function cornerIndex(t: TerrainData, ix: number, iz: number): number {
  return iz * (t.width + 1) + ix;
}

export function cellIndex(t: Pick<TerrainData, 'width'>, cx: number, cz: number): number {
  return cz * t.width + cx;
}

export function cellCoord(t: Pick<TerrainData, 'width'>, index: number): CellCoord {
  return { cx: index % t.width, cz: Math.floor(index / t.width) };
}

export function inBounds(t: Pick<TerrainData, 'width' | 'depth'>, cx: number, cz: number): boolean {
  return cx >= 0 && cz >= 0 && cx < t.width && cz < t.depth;
}

export function cellAt(t: TerrainData, x: number, z: number): CellCoord {
  return { cx: Math.floor(x / t.cellSize), cz: Math.floor(z / t.cellSize) };
}

export function cellCenter(t: Pick<TerrainData, 'cellSize'>, cx: number, cz: number): { x: number; z: number } {
  return { x: (cx + 0.5) * t.cellSize, z: (cz + 0.5) * t.cellSize };
}

export function heightAtCorner(t: TerrainData, ix: number, iz: number): number {
  const x = ix < 0 ? 0 : ix > t.width ? t.width : ix;
  const z = iz < 0 ? 0 : iz > t.depth ? t.depth : iz;
  return t.heights[cornerIndex(t, x, z)] as number;
}

export function setHeightAtCorner(t: TerrainData, ix: number, iz: number, h: number): void {
  t.heights[cornerIndex(t, ix, iz)] = h;
}

export function layerAt(t: TerrainData, cx: number, cz: number): TerrainLayerId {
  return t.layers[cellIndex(t, cx, cz)] as TerrainLayerId;
}

export function setLayer(t: TerrainData, cx: number, cz: number, layer: TerrainLayerId): void {
  t.layers[cellIndex(t, cx, cz)] = layer;
}

/** Bilinear height at a world position, clamped to the map extents. */
export function sampleHeight(t: TerrainData, x: number, z: number): number {
  const gx = Math.min(Math.max(x / t.cellSize, 0), t.width);
  const gz = Math.min(Math.max(z / t.cellSize, 0), t.depth);
  const ix = Math.min(Math.floor(gx), t.width - 1);
  const iz = Math.min(Math.floor(gz), t.depth - 1);
  const fx = gx - ix;
  const fz = gz - iz;
  const h00 = heightAtCorner(t, ix, iz);
  const h10 = heightAtCorner(t, ix + 1, iz);
  const h01 = heightAtCorner(t, ix, iz + 1);
  const h11 = heightAtCorner(t, ix + 1, iz + 1);
  const a = h00 + (h10 - h00) * fx;
  const b = h01 + (h11 - h01) * fx;
  return a + (b - a) * fz;
}

/** Height at a cell centre (mean of its four corners, identical to the bilinear sample). */
export function cellCenterHeight(t: TerrainData, cx: number, cz: number): number {
  return (
    (heightAtCorner(t, cx, cz) + heightAtCorner(t, cx + 1, cz) + heightAtCorner(t, cx, cz + 1) + heightAtCorner(t, cx + 1, cz + 1)) *
    0.25
  );
}

/** Magnitude of the height gradient (rise / run) across a cell. */
export function cellGrade(t: TerrainData, cx: number, cz: number): number {
  const h00 = heightAtCorner(t, cx, cz);
  const h10 = heightAtCorner(t, cx + 1, cz);
  const h01 = heightAtCorner(t, cx, cz + 1);
  const h11 = heightAtCorner(t, cx + 1, cz + 1);
  const gx = (h10 + h11 - h00 - h01) / (2 * t.cellSize);
  const gz = (h01 + h11 - h00 - h10) / (2 * t.cellSize);
  return Math.sqrt(gx * gx + gz * gz);
}
