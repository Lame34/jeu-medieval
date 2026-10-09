/** 2D geometry helpers for world generation (ground plane, metres). */
import type { Vec2 } from '../math/vec2.ts';

export interface SegmentProjection {
  readonly distance: number;
  /** Arc length from the polyline start to the closest point. */
  readonly along: number;
  readonly point: Vec2;
}

/** Closest point on a polyline, with the distance along it. */
export function projectOnPolyline(p: Vec2, line: readonly Vec2[]): SegmentProjection {
  let best: SegmentProjection = { distance: Number.POSITIVE_INFINITY, along: 0, point: line[0] ?? p };
  let travelled = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lenSq = abx * abx + abz * abz;
    const segLen = Math.sqrt(lenSq);
    const t = lenSq > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq)) : 0;
    const qx = a.x + abx * t;
    const qz = a.z + abz * t;
    const d = Math.hypot(p.x - qx, p.z - qz);
    if (d < best.distance) best = { distance: d, along: travelled + segLen * t, point: { x: qx, z: qz } };
    travelled += segLen;
  }
  return best;
}

/** Distance from (px, pz) to segment ab, with exactly the arithmetic of projectOnPolyline. */
export function segmentDistance(px: number, pz: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  const t = lenSq > 0 ? Math.min(1, Math.max(0, ((px - a.x) * abx + (pz - a.z) * abz) / lenSq)) : 0;
  return Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t));
}

/**
 * Distances from the points of a regular grid (x = originX + i·step, z = originZ + j·step,
 * i < cols, j < rows) to a polyline, wherever they are at most `maxDistance` (Infinity
 * elsewhere). Each segment only visits the points of its own bounding box, so a long road or
 * river costs its length, not the map's area × its segment count; the values are exactly
 * projectOnPolyline(...).distance (same arithmetic, minimum over the same segments).
 */
export class PolylineDistanceGrid {
  readonly originX: number;
  readonly originZ: number;
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  private readonly d: Float64Array;

  constructor(line: readonly Vec2[], originX: number, originZ: number, step: number, cols: number, rows: number, maxDistance: number) {
    this.originX = originX;
    this.originZ = originZ;
    this.step = step;
    this.cols = cols;
    this.rows = rows;
    this.d = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
    for (let k = 0; k < line.length - 1; k++) {
      const a = line[k] as Vec2;
      const b = line[k + 1] as Vec2;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - maxDistance - originX) / step));
      const i1 = Math.min(cols - 1, Math.ceil((Math.max(a.x, b.x) + maxDistance - originX) / step));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - maxDistance - originZ) / step));
      const j1 = Math.min(rows - 1, Math.ceil((Math.max(a.z, b.z) + maxDistance - originZ) / step));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dist = segmentDistance(originX + i * step, originZ + j * step, a, b);
          const at = j * cols + i;
          if (dist <= maxDistance && dist < (this.d[at] as number)) this.d[at] = dist;
        }
      }
    }
  }

  /** Distance at grid point (i, j); Infinity outside the grid or beyond the maximum distance. */
  at(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return Number.POSITIVE_INFINITY;
    return this.d[j * this.cols + i] as number;
  }

  /** Distance at the grid point (x, z) lies on (it must be one: x = originX + i·step). */
  atPoint(x: number, z: number): number {
    return this.at(Math.round((x - this.originX) / this.step), Math.round((z - this.originZ) / this.step));
  }
}

export function polylineLength(line: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total;
}

/** Point at arc length `s` along the polyline (clamped). */
export function pointAlong(line: readonly Vec2[], s: number): Vec2 {
  let remaining = s;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (remaining <= len && len > 0) {
      const t = remaining / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= len;
  }
  return line[line.length - 1] ?? { x: 0, z: 0 };
}

/** Centripetal-free uniform Catmull–Rom resampling: smooth curves through control points. */
/** The part of a polyline between arc lengths `from` and `to`. */
export function subPolyline(line: readonly Vec2[], from: number, to: number): Vec2[] {
  const out: Vec2[] = [pointAlong(line, from)];
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Vec2;
    const b = line[i] as Vec2;
    s += Math.hypot(b.x - a.x, b.z - a.z);
    if (s > from && s < to) out.push(b);
  }
  out.push(pointAlong(line, to));
  return out;
}

export function catmullRom(points: readonly Vec2[], samplesPerSegment: number): Vec2[] {
  if (points.length < 2) return [...points];
  const out: Vec2[] = [];
  const at = (i: number): Vec2 => points[Math.min(Math.max(i, 0), points.length - 1)] as Vec2;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const blend = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: blend(p0.x, p1.x, p2.x, p3.x), z: blend(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(points[points.length - 1] as Vec2);
  return out;
}

/** Extends a polyline at both ends along its end tangents (rivers running off to the horizon). */
export function extendPolyline(line: readonly Vec2[], meters: number, stepM: number): Vec2[] {
  if (line.length < 2) return [...line];
  const extend = (end: Vec2, before: Vec2): Vec2[] => {
    const dx = end.x - before.x;
    const dz = end.z - before.z;
    const len = Math.hypot(dx, dz) || 1;
    const out: Vec2[] = [];
    for (let s = stepM; s <= meters; s += stepM) out.push({ x: end.x + (dx / len) * s, z: end.z + (dz / len) * s });
    return out;
  };
  const head = extend(line[0] as Vec2, line[1] as Vec2).reverse();
  const tail = extend(line[line.length - 1] as Vec2, line[line.length - 2] as Vec2);
  return [...head, ...line, ...tail];
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[j] as Vec2;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to the polygon boundary (positive), useful for soft edges. */
export function distanceToPolygonEdge(p: Vec2, polygon: readonly Vec2[]): number {
  const closed = [...polygon, polygon[0] as Vec2];
  return projectOnPolyline(p, closed).distance;
}

/** Oriented rectangle corners (rotation in turns, counter-clockwise seen from +y). */
export function orientedRect(center: Vec2, width: number, depth: number, rotationTurns: number): Vec2[] {
  const a = rotationTurns * 2 * Math.PI;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = width / 2;
  const hd = depth / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([x, z]) => ({ x: center.x + (x as number) * c - (z as number) * s, z: center.z + (x as number) * s + (z as number) * c }));
}
