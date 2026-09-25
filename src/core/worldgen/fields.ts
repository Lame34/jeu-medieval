/**
 * Field parcels (brief §9.12 step 4): bounded Voronoi cells around farm seeds, clipped by
 * half-planes (Sutherland–Hodgman), shrunk to leave room for hedges and dry-stone walls.
 */
import type { Vec2 } from '../math/vec2.ts';
import type { Rng } from '../rng.ts';
import type { CropKind, FieldPatch, HedgeLine } from './types.ts';

export interface ParcelOptions {
  readonly maxCellRadiusM: number;
  /** Border inset leaving a strip for hedges (m). */
  readonly insetM: number;
  readonly minAreaM2: number;
}

function clipHalfPlane(poly: Vec2[], a: Vec2, normal: Vec2, offset: number): Vec2[] {
  // Keep points p with dot(p - a, normal) <= offset.
  const out: Vec2[] = [];
  const side = (p: Vec2) => (p.x - a.x) * normal.x + (p.z - a.z) * normal.z - offset;
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i] as Vec2;
    const prev = poly[(i + poly.length - 1) % poly.length] as Vec2;
    const sc = side(cur);
    const sp = side(prev);
    if (sc <= 0) {
      if (sp > 0) out.push(lerpAt(prev, cur, sp / (sp - sc)));
      out.push(cur);
    } else if (sp <= 0) {
      out.push(lerpAt(prev, cur, sp / (sp - sc)));
    }
  }
  return out;
}

function lerpAt(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function polygonArea(poly: readonly Vec2[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2;
    const b = poly[(i + 1) % poly.length] as Vec2;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}

/** Bounded Voronoi cell of `seeds[index]`, shrunk inwards by `insetM` on every border. */
export function voronoiCell(seeds: readonly Vec2[], index: number, options: ParcelOptions): Vec2[] {
  const s = seeds[index] as Vec2;
  const r = options.maxCellRadiusM;
  let poly: Vec2[] = [
    { x: s.x - r, z: s.z - r },
    { x: s.x + r, z: s.z - r },
    { x: s.x + r, z: s.z + r },
    { x: s.x - r, z: s.z + r },
  ];
  for (let j = 0; j < seeds.length && poly.length > 2; j++) {
    if (j === index) continue;
    const o = seeds[j] as Vec2;
    const dx = o.x - s.x;
    const dz = o.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d === 0 || d > 2 * r * Math.SQRT2) continue;
    const normal = { x: dx / d, z: dz / d };
    poly = clipHalfPlane(poly, s, normal, d / 2 - options.insetM);
  }
  return poly;
}

export interface ParcelResult {
  readonly fields: FieldPatch[];
  readonly hedges: HedgeLine[];
}

const CROPS: readonly { readonly weight: number; readonly crop: CropKind }[] = [
  { weight: 5, crop: 'wheat' },
  { weight: 3, crop: 'rye' },
  { weight: 2, crop: 'fallow' },
];
const HEDGE_CHANCE = 0.55;
const DRY_STONE_CHANCE = 0.35;

/** Builds parcels around seeds; `accept(poly)` rejects parcels overlapping roads, water, etc. */
export function buildParcels(rng: Rng, seeds: readonly Vec2[], options: ParcelOptions, accept: (poly: readonly Vec2[]) => boolean, idPrefix: string): ParcelResult {
  const fields: FieldPatch[] = [];
  const hedges: HedgeLine[] = [];
  seeds.forEach((_, i) => {
    const poly = voronoiCell(seeds, i, options);
    if (poly.length < 3 || polygonArea(poly) < options.minAreaM2 || !accept(poly)) return;
    const crop = rng.weighted(CROPS).crop;
    const id = `${idPrefix}field-${i}`;
    fields.push({ id, crop, polygon: poly, furrowTurns: rng.next() });
    // Some borders get a hedge or a dry-stone wall, just outside the parcel.
    for (let e = 0; e < poly.length; e++) {
      if (!rng.chance(HEDGE_CHANCE)) continue;
      const a = poly[e] as Vec2;
      const b = poly[(e + 1) % poly.length] as Vec2;
      const kind = rng.chance(DRY_STONE_CHANCE) ? 'dryStoneWall' : 'hedge';
      const c = polygonCentroid(poly);
      const push = (p: Vec2) => {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const l = Math.hypot(dx, dz) || 1;
        return { x: p.x + (dx / l) * options.insetM * 0.6, z: p.z + (dz / l) * options.insetM * 0.6 };
      };
      hedges.push({ id: `${id}-edge-${e}`, kind, points: [push(a), push(b)] });
    }
  });
  return { fields, hedges };
}
