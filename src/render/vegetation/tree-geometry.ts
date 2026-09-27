/**
 * Procedural stylised vegetation (plank-test candidate "b", ADR pending): opaque, generous
 * canopies built from noisy blobs whose normals are blended towards a canopy-wide ellipsoid —
 * soft, painterly light across the crown instead of faceted clumps, and zero alpha-test
 * shimmering. All colours come from the palette as vertex colours.
 */
import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, IcosahedronGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createSimplex } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';
import type { TreeSpecies } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';

export const TREE_VARIANTS = 5;

export interface SpeciesStyle {
  readonly heightM: number;
  readonly windSwayM: number;
}

export const SPECIES_STYLE: Readonly<Record<TreeSpecies, SpeciesStyle>> = {
  oak: { heightM: 7.4, windSwayM: 0.22 },
  beech: { heightM: 8.8, windSwayM: 0.22 },
  birch: { heightM: 8.2, windSwayM: 0.3 },
  pine: { heightM: 9.5, windSwayM: 0.15 },
  bush: { heightM: 1.4, windSwayM: 0.06 },
  fern: { heightM: 0.8, windSwayM: 0.08 },
};

const BARK = '#5b4633';
const CANOPY_BUMP = 0.28;
const CANOPY_BUMP_FINE = 0.08;
const CANOPY_NORMAL_BLEND = 0.5;
const BIRCH_BARK = '#d9d2c1';
const BIRCH_MARK = '#3b342c';

interface Blob {
  readonly center: Vector3;
  readonly radius: number;
}

interface CanopySpec {
  readonly center: Vector3;
  readonly radii: Vector3;
  readonly blobCount: number;
  readonly blobRadius: readonly [number, number];
  readonly lit: string;
  readonly base: string;
  readonly detail: number;
}

function paint(geometry: BufferGeometry, colorAt: (p: Vector3, n: Vector3) => Color): BufferGeometry {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const c = colorAt(p, n);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function trunk(rng: Rng, heightM: number, radius: number, bark: string, marks?: string): BufferGeometry {
  const g = new CylinderGeometry(radius * 0.55, radius, heightM, 7, 4, true);
  g.translate(0, heightM / 2, 0);
  const pos = g.getAttribute('position');
  const bend = new Vector3(rng.float(-0.25, 0.25), 0, rng.float(-0.25, 0.25));
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y / heightM;
    const flare = 1 + Math.max(0, 0.25 - t) * 1.6; // root flare
    pos.setXYZ(i, v.x * flare + bend.x * t * t * heightM * 0.2, v.y, v.z * flare + bend.z * t * t * heightM * 0.2);
  }
  g.computeVertexNormals();
  const barkColor = new Color(bark);
  const markColor = marks ? new Color(marks) : null;
  return paint(g, (p) => {
    const c = barkColor.clone().multiplyScalar(0.8 + 0.3 * (p.y / heightM));
    if (markColor && Math.sin(p.y * 7.3 + p.x * 3.1) > 0.82) c.lerp(markColor, 0.7);
    return c;
  });
}

/** 2–3 main boughs leaving the trunk under the crown (visible from the tactical angle). */
function branches(rng: Rng, trunkTopM: number, radius: number, bark: string): BufferGeometry[] {
  const count = rng.int(2, 3);
  const out: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const len = rng.float(1.4, 2.0);
    const g = new CylinderGeometry(radius * 0.5, radius, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    g.rotateZ(rng.float(0.6, 0.95));
    g.rotateY((i / count) * Math.PI * 2 + rng.float(-0.4, 0.4));
    g.translate(0, trunkTopM * rng.float(0.75, 0.95), 0);
    const barkColor = new Color(bark);
    out.push(paint(g, () => barkColor.clone().multiplyScalar(0.85)));
  }
  return out;
}

function canopy(rng: Rng, spec: CanopySpec): BufferGeometry {
  const noise = createSimplex(rng.fork('canopy-noise'));
  const blobs: Blob[] = [];
  for (let i = 0; i < spec.blobCount; i++) {
    // Blobs sit on an inner shell of the crown ellipsoid, biased upwards and outwards.
    const u = rng.next() * 2 * Math.PI;
    const vy = rng.float(-0.35, 0.9);
    const ring = Math.sqrt(1 - vy * vy);
    const shell = rng.float(0.45, 0.72);
    blobs.push({
      center: new Vector3(
        spec.center.x + Math.cos(u) * ring * spec.radii.x * shell,
        spec.center.y + vy * spec.radii.y * shell,
        spec.center.z + Math.sin(u) * ring * spec.radii.z * shell,
      ),
      radius: rng.float(spec.blobRadius[0], spec.blobRadius[1]),
    });
  }
  blobs.push({ center: spec.center.clone(), radius: Math.min(spec.radii.x, spec.radii.y) * 0.7 });

  const lit = new Color(spec.lit);
  const base = new Color(spec.base);
  const parts = blobs.map((blob) => {
    const g = new IcosahedronGeometry(blob.radius, spec.detail);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const v = new Vector3();
    const n = new Vector3();
    const e = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // Sphere normal at every detail level (detail 0 would otherwise be flat-shaded facets).
      n.copy(v).normalize();
      // Two octaves of bumps: scalloped, leafy silhouettes instead of smooth spheres.
      const nx = v.x + blob.center.x;
      const nz = v.y + blob.center.z + v.z * 0.5;
      const bump = 1 + CANOPY_BUMP * noise(nx * 0.9, nz * 0.9) + CANOPY_BUMP_FINE * noise(nx * 2.6 + 11, nz * 2.6);
      v.multiplyScalar(bump).add(blob.center);
      pos.setXYZ(i, v.x, v.y, v.z);
      // Soft crown lighting: blob normal blended with the crown ellipsoid normal (clumps stay legible).
      e.copy(v).sub(spec.center).divide(spec.radii).divide(spec.radii).normalize();
      n.lerp(e, CANOPY_NORMAL_BLEND).normalize();
      nor.setXYZ(i, n.x, n.y, n.z);
    }
    return paint(g, (p, nn) => {
      const height01 = Math.min(1, Math.max(0, (p.y - (spec.center.y - spec.radii.y)) / (2 * spec.radii.y)));
      const outward = Math.min(1, Math.max(0, p.clone().sub(spec.center).divide(spec.radii).length()));
      // Darker core, lit outer top: painted depth inside the crown.
      const t = Math.min(1, 0.05 + 0.5 * height01 + 0.5 * outward * outward + 0.15 * nn.y);
      return base.clone().lerp(lit, t);
    });
  });
  const merged = mergeGeometries(parts.map(nonIndexed), false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('canopy merge failed');
  return merged;
}

function coniferLayers(rng: Rng, heightM: number): BufferGeometry {
  const noise = createSimplex(rng.fork('pine-noise'));
  const lit = new Color(PALETTE.conifer.lit);
  const base = new Color(PALETTE.conifer.base);
  const layers = 4;
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const radius = (2.4 - 1.6 * t) * rng.float(0.9, 1.1);
    const coneH = 3.0 - 0.9 * t;
    const y = 1.6 + t * (heightM - 4.2) + coneH / 2;
    const g = new ConeGeometry(radius, coneH, 9, 2, true);
    const pos = g.getAttribute('position');
    const v = new Vector3();
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k);
      const r = Math.hypot(v.x, v.z);
      const wobble = 1 + 0.18 * noise(v.x * 1.3 + i * 7, v.z * 1.3) * (r / radius);
      pos.setXYZ(k, v.x * wobble, v.y + y - (r / radius) * 0.25, v.z * wobble);
    }
    g.computeVertexNormals();
    parts.push(
      paint(g, (p, n) => base.clone().lerp(lit, Math.min(1, 0.2 + 0.5 * ((p.y - 1.6) / heightM) + 0.3 * Math.max(0, n.y)))),
    );
  }
  const merged = mergeGeometries(parts.map(nonIndexed), false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('conifer merge failed');
  return merged;
}

function fern(rng: Rng): BufferGeometry {
  const fronds = rng.int(6, 9);
  const segments = 4;
  const positions: number[] = [];
  const colors: number[] = [];
  const lit = new Color('#8aa84a');
  const base = new Color(PALETTE.moss.base);
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * 2 * Math.PI + rng.float(-0.2, 0.2);
    const len = rng.float(0.65, 1.0);
    const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new Vector3(-dir.z, 0, dir.x);
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      const pAt = (t: number) => dir.clone().multiplyScalar(t * len).setY(Math.sin(t * Math.PI * 0.8) * 0.45 * len);
      const w0 = 0.12 * Math.sin((t0 * 0.9 + 0.1) * Math.PI) * len;
      const w1 = 0.12 * Math.sin((t1 * 0.9 + 0.1) * Math.PI) * len;
      const a0 = pAt(t0).addScaledVector(side, -w0);
      const b0 = pAt(t0).addScaledVector(side, w0);
      const a1 = pAt(t1).addScaledVector(side, -w1);
      const b1 = pAt(t1).addScaledVector(side, w1);
      for (const q of [a0, a1, b0, b0, a1, b1]) positions.push(q.x, q.y, q.z);
      const c0 = base.clone().lerp(lit, 0.3 + 0.7 * t0);
      const c1 = base.clone().lerp(lit, 0.3 + 0.7 * t1);
      for (const c of [c0, c1, c0, c0, c1, c1]) colors.push(c.r, c.g, c.b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  // Ferns read best lit from above: bias normals upwards.
  const nor = g.getAttribute('normal');
  const n = new Vector3();
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i);
    if (n.y < 0) n.negate();
    n.lerp(new Vector3(0, 1, 0), 0.5).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

/** Bush looks: mossy, dark olive, and a flowering one (hawthorn / dog-rose speckles). */
const BUSH_STYLES = [
  { lit: PALETTE.moss.lit, base: PALETTE.moss.base, flowers: null },
  { lit: '#7d8c46', base: '#3b4724', flowers: null },
  { lit: '#77894a', base: '#404f2a', flowers: null },
] as const;
const FLOWER_DENSITY = 0;

/** Paints small flower speckles on the upper, outward faces of a bush. */
function sprinkleFlowers(g: BufferGeometry, rng: Rng, hex: string): void {
  const flower = new Color(hex);
  const colors = g.getAttribute('color');
  const normals = g.getAttribute('normal');
  // Non-indexed: recolour whole triangles so speckles stay crisp.
  for (let tri = 0; tri < colors.count / 3; tri++) {
    const ny = normals.getY(tri * 3);
    if (ny < 0.1 || rng.next() > FLOWER_DENSITY) continue;
    for (let k = 0; k < 3; k++) colors.setXYZ(tri * 3 + k, flower.r, flower.g, flower.b);
  }
}

function nonIndexed(g: BufferGeometry): BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

function mergeAll(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts.map(nonIndexed), false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('tree merge failed');
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/**
 * Builds variant `variant` of a species; deterministic. `lod` 1 uses faceted blobs and fewer of
 * them (~1/4 of the triangles) for distant forests.
 */
export function buildTreeGeometry(species: TreeSpecies, variant: number, lod: 0 | 1 = 0): BufferGeometry {
  const rng = Rng.create(`tree:${species}:${variant}`);
  const detail = lod === 0 ? 1 : 0;
  const blobs = (n: number) => (lod === 0 ? n : Math.max(3, Math.ceil(n / 2)));
  switch (species) {
    case 'oak': {
      const h = rng.float(2.3, 2.9);
      return mergeAll([
        trunk(rng, h + 1.2, 0.42, BARK),
        ...(lod === 0 ? branches(rng, h, 0.16, BARK) : []),
        canopy(rng, { center: new Vector3(0, h + 2.2, 0), radii: new Vector3(3.0, 2.3, 2.9), blobCount: blobs(12), blobRadius: [1.0, 1.5], lit: PALETTE.foliage.lit, base: PALETTE.foliage.base, detail }),
      ]);
    }
    case 'beech': {
      const h = rng.float(3.0, 3.6);
      return mergeAll([
        trunk(rng, h + 1.6, 0.36, '#6b5a48'),
        ...(lod === 0 ? branches(rng, h + 0.4, 0.13, '#6b5a48') : []),
        canopy(rng, { center: new Vector3(0, h + 2.9, 0), radii: new Vector3(2.6, 3.0, 2.6), blobCount: blobs(12), blobRadius: [0.95, 1.4], lit: '#96ae4e', base: '#3c5528', detail }),
      ]);
    }
    case 'birch': {
      const h = rng.float(3.6, 4.4);
      return mergeAll([
        trunk(rng, h + 2.0, 0.16, BIRCH_BARK, BIRCH_MARK),
        canopy(rng, { center: new Vector3(0, h + 2.4, 0), radii: new Vector3(1.5, 2.6, 1.5), blobCount: blobs(7), blobRadius: [0.75, 1.1], lit: '#a8bb5d', base: '#566f38', detail }),
      ]);
    }
    case 'pine': {
      const h = SPECIES_STYLE.pine.heightM * rng.float(0.9, 1.08);
      return mergeAll([trunk(rng, 2.4, 0.26, BARK), coniferLayers(rng, h)]);
    }
    case 'bush': {
      const style = BUSH_STYLES[variant % BUSH_STYLES.length] as (typeof BUSH_STYLES)[number];
      const g = mergeAll([
        canopy(rng, { center: new Vector3(0, 0.55, 0), radii: new Vector3(1.0, 0.65, 1.0), blobCount: blobs(5), blobRadius: [0.45, 0.75], lit: style.lit, base: style.base, detail }),
      ]);
      if (style.flowers) sprinkleFlowers(g, rng, style.flowers);
      return g;
    }
    case 'fern':
      return fern(rng);
  }
}
