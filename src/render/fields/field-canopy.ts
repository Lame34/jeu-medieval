/**
 * The fields' canopy (ADR-055): a painted surface at the crop's height over each parcel, seen
 * wherever the tufts are not drawn — far from the camera, and at the edges of the screen. Built
 * once per scene: a grid of 1.5 m clipped to the parcel (convex Voronoi cells), lowered towards
 * the edges as the tufts are, with a skirt down to the ground along the borders so a field keeps
 * its volume seen from the side. Its vertex data carries the height above the ground (the shader
 * sinks the canopy where the tufts take over), the furrows' direction and how far in from the
 * thinning border the crop is dense (0 on the border, 1 past EDGE_FADE_M). Each point of the grid
 * is worked out once (shared by up to six triangles; its neighbours give the normals).
 */
import { BufferAttribute, BufferGeometry, Color } from 'three';
import { createSimplex } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { segmentDistance } from '../../core/worldgen/geometry.ts';
import type { FieldPatch } from '../../core/worldgen/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { Tone } from '../materials/season-palette.ts';

const GRID_M = 1.5;
/** The crop thins out over this band along the border (as the tufts do), and stands this low at the very edge. */
export const EDGE_FADE_M = 2.2;
const EDGE_HEIGHT = 0.55;
/** The canopy's top over the tufts' mean height, and its undulation. */
const TOP_SHARE = 0.9;
const TOP_UNDULATION = 0.08;
/** The skirt starts this far under the ground (hidden by the terrain). */
const SKIRT_UNDER_M = 0.12;
/** Normals: blended this much towards the vertical (a soft lit mass, like the tufts). */
const NORMAL_UP = 0.45;
/** Finite difference step for the canopy's normals (m): a grid step, so the neighbours are grid points worked out already. */
const SLOPE_STEP_M = GRID_M;
/** Points are cached by their position rounded to 1/KEY_SCALE m (fields lie within KEY_SPAN/KEY_SCALE m of the origin). */
const KEY_SCALE = 64;
const KEY_SPAN = 1_000_000;

export interface CanopyField {
  readonly field: FieldPatch;
  readonly tone: Tone;
}

interface Builder {
  readonly positions: number[];
  readonly normals: number[];
  readonly colors: number[];
  readonly data: number[];
}

/** Sutherland–Hodgman: the part of `poly` where `keep` (a signed distance to a line) is not negative. */
function clipHalfPlane(poly: readonly Vec2[], keep: (p: Vec2) => number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    const dp = keep(p);
    const dq = keep(q);
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out;
}

/** The parcel's part within the grid cell [x0, x1] × [z0, z1]. */
function clipToCell(poly: readonly Vec2[], x0: number, z0: number, x1: number, z1: number): Vec2[] {
  let piece: Vec2[] = [...poly];
  piece = clipHalfPlane(piece, (p) => p.x - x0);
  if (piece.length >= 3) piece = clipHalfPlane(piece, (p) => x1 - p.x);
  if (piece.length >= 3) piece = clipHalfPlane(piece, (p) => p.z - z0);
  if (piece.length >= 3) piece = clipHalfPlane(piece, (p) => z1 - p.z);
  return piece;
}

function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Distance from (x, z) to the parcel's border, without allocating. */
function edgeDistance(poly: readonly Vec2[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segmentDistance(x, z, poly[i] as Vec2, poly[(i + 1) % poly.length] as Vec2));
  return best;
}

/** A point of the canopy: the ground under it, the canopy's height above it, how dense the crop is there (0 on the border). */
interface CanopyPoint {
  readonly ground: number;
  readonly top: number;
  readonly dense: number;
}

function pushVertex(b: Builder, x: number, y: number, z: number, n: readonly [number, number, number], c: Color, height: number, furrow: readonly [number, number], dense: number): void {
  b.positions.push(x, y, z);
  b.normals.push(n[0], n[1], n[2]);
  b.colors.push(c.r, c.g, c.b);
  b.data.push(height, furrow[0], furrow[1], dense);
}

const lit = new Color();
const base = new Color();
const tone = new Color();

function addField(b: Builder, f: CanopyField, terrain: TerrainData, heightM: number): void {
  const poly = f.field.polygon;
  const noise = createSimplex(Rng.create(`canopy:${f.field.id}`));
  const angle = f.field.furrowTurns * Math.PI * 2;
  const furrow: readonly [number, number] = [Math.cos(angle), Math.sin(angle)];
  lit.set(f.tone.lit);
  base.set(f.tone.base);
  const colorAt = (x: number, z: number): Color => {
    // The tufts' tones: ripe light with the base's shade, a broad value variation over the parcel.
    const v = 0.9 + 0.2 * (noise(x * 0.08, z * 0.08) * 0.5 + 0.5);
    return tone.copy(base).lerp(lit, 0.62 + 0.18 * noise(x * 0.31 + 7, z * 0.31)).multiplyScalar(v);
  };
  const points = new Map<number, CanopyPoint>();
  // Lower towards the border, gently undulating.
  const pointAt = (x: number, z: number): CanopyPoint => {
    const key = Math.round(x * KEY_SCALE) * KEY_SPAN + Math.round(z * KEY_SCALE);
    let p = points.get(key);
    if (!p) {
      const edge = edgeDistance(poly, x, z);
      const top = heightM * TOP_SHARE * Math.min(1, EDGE_HEIGHT + edge / EDGE_FADE_M) * (1 - TOP_UNDULATION + TOP_UNDULATION * (noise(x * 0.11, z * 0.11) * 0.5 + 0.5));
      p = { ground: sampleHeight(terrain, x, z), top, dense: Math.min(1, edge / EDGE_FADE_M) };
      points.set(key, p);
    }
    return p;
  };
  const surfaceAt = (x: number, z: number) => {
    const p = pointAt(x, z);
    return p.ground + p.top;
  };
  const normalAt = (x: number, z: number): [number, number, number] => {
    const dx = (surfaceAt(x + SLOPE_STEP_M, z) - surfaceAt(x - SLOPE_STEP_M, z)) / (2 * SLOPE_STEP_M);
    const dz = (surfaceAt(x, z + SLOPE_STEP_M) - surfaceAt(x, z - SLOPE_STEP_M)) / (2 * SLOPE_STEP_M);
    let nx = -dx * (1 - NORMAL_UP);
    let ny = 1;
    let nz = -dz * (1 - NORMAL_UP);
    const len = Math.hypot(nx, ny, nz);
    nx /= len;
    ny /= len;
    nz /= len;
    return [nx, ny, nz];
  };
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  const i0 = Math.floor(Math.min(...xs) / GRID_M);
  const i1 = Math.ceil(Math.max(...xs) / GRID_M);
  const j0 = Math.floor(Math.min(...zs) / GRID_M);
  const j1 = Math.ceil(Math.max(...zs) / GRID_M);
  const ccw = signedArea(poly) > 0;
  // The top: each grid cell clipped to the parcel, fanned from its first corner (convex pieces).
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const piece = clipToCell(poly, i * GRID_M, j * GRID_M, (i + 1) * GRID_M, (j + 1) * GRID_M);
      if (piece.length < 3) continue;
      const first = piece[0] as Vec2;
      for (let k = 1; k + 1 < piece.length; k++) {
        const tri = [first, piece[k] as Vec2, piece[k + 1] as Vec2];
        // Counter-clockwise seen from above (+y): the top faces the sky.
        const order = ccw ? [0, 2, 1] : [0, 1, 2];
        for (const o of order) {
          const p = tri[o] as Vec2;
          const point = pointAt(p.x, p.z);
          pushVertex(b, p.x, point.ground + point.top, p.z, normalAt(p.x, p.z), colorAt(p.x, p.z), point.top, furrow, point.dense);
        }
      }
    }
  }
  // The skirt: the parcel's border, from under the ground up to the canopy's edge.
  for (let e = 0; e < poly.length; e++) {
    const a = poly[e] as Vec2;
    const c = poly[(e + 1) % poly.length] as Vec2;
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 1e-3) continue;
    const steps = Math.max(1, Math.ceil(len / GRID_M));
    // Outward horizontal normal (the parcel on the left of a→c when counter-clockwise).
    const sx = (c.z - a.z) / len;
    const sz = -(c.x - a.x) / len;
    const out: [number, number, number] = ccw ? [sx, 0.35, sz] : [-sx, 0.35, -sz];
    const norm = Math.hypot(out[0], out[1], out[2]);
    const n: [number, number, number] = [out[0] / norm, out[1] / norm, out[2] / norm];
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const p0 = { x: a.x + (c.x - a.x) * t0, z: a.z + (c.z - a.z) * t0 };
      const p1 = { x: a.x + (c.x - a.x) * t1, z: a.z + (c.z - a.z) * t1 };
      const { ground: g0, top: h0 } = pointAt(p0.x, p0.z);
      const { ground: g1, top: h1 } = pointAt(p1.x, p1.z);
      const quad: [number, number, number, number][] = [
        [p0.x, g0 - SKIRT_UNDER_M, p0.z, 0],
        [p1.x, g1 - SKIRT_UNDER_M, p1.z, 0],
        [p1.x, g1 + h1, p1.z, h1],
        [p0.x, g0 + h0, p0.z, h0],
      ];
      // Facing outwards.
      const order = ccw ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const o of order) {
        const q = quad[o] as [number, number, number, number];
        pushVertex(b, q[0], q[1], q[2], n, colorAt(q[0], q[2]), q[3], furrow, 0);
      }
    }
  }
}

/** The canopy of every crop parcel (fallow ones have none), with `heightM` the tufts' height this season. */
export function buildCanopyGeometry(fields: readonly CanopyField[], terrain: TerrainData, heightM: number): BufferGeometry {
  const b: Builder = { positions: [], normals: [], colors: [], data: [] };
  for (const f of fields) addField(b, f, terrain, heightM);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(b.normals), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(b.colors), 3));
  g.setAttribute('aPaintedData', new BufferAttribute(new Float32Array(b.data), 4));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
