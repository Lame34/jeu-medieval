/**
 * Decorative ring around the playable map (brief §5.4, §7): low-resolution rolling hills whose
 * cells grow with distance, stitched to the map border heights, dressed with cheap forest
 * clumps and swallowed by the aerial fog before the painted mountains of the sky take over.
 * The map edge is never visible.
 */
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, ConeGeometry, DataTexture, IcosahedronGeometry, InstancedMesh, LinearFilter, Matrix4, Mesh, Quaternion, RGBAFormat, UnsignedByteType, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, smoothstep } from '../../core/math/scalar.ts';
import { createSimplex, fbm, type FbmOptions } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { projectOnPolyline } from '../../core/worldgen/geometry.ts';
import type { WaterBody } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { extendedRiver } from '../water/river-extension.ts';
import { createTerrainMaterial } from './terrain-material.ts';

const RING_RADIUS_M = 2600;
const BORDER_STEP_M = 2;
const FIRST_STEP_M = 2;
const STEP_GROWTH = 1.22;
const HIDDEN_DROP_M = 3.5;
const EDGE_BLEND_M = 200;
/** The edge slope carries on into the ring (bounded), fading over this distance (m). */
const EDGE_SLOPE_FADE_M = 40;
const EDGE_SLOPE_MAX = 0.25;
const EDGE_SLOPE_PROBE_M = 4;
/** Ring vertices closer than this to the map take analytic normals (no crease at the seam). */
const SEAM_NORMALS_M = 60;
const SPLAT_SIZE = 512;
/** Forest floor radius under a clump, in clump scales (the canopy's footprint and its shade). */
const CLUMP_FLOOR_RADIUS = 1.6;
const FAR_CLUMPS = 1800;
/** Clumps start right at the map edge: a bare first strip is what signs "outside". */
const CLUMP_MIN_DIST_M = 6;
const CLUMP_MAX_DIST_M = 900;
/** Clumps within this distance of the map use the detailed blob, up to this count. */
const NEAR_CLUMPS_DIST_M = 40;
/** Extra forest cover in a belt past the map edge (m). */
const EDGE_BELT = 0.35;
const EDGE_BELT_M: readonly [number, number] = [20, 120];
const NEAR_CLUMPS_MAX = 320;
/** Placement attempts per clump (massifs are sparse: most samples fall in clearings). */
const CLUMP_ATTEMPTS = 18;
/** Clumps per massif (min, max). */
const MASSIF_CHILDREN: readonly [number, number] = [6, 14];

interface Lobe {
  readonly scale: readonly [number, number, number];
  readonly at: readonly [number, number, number];
}

const CLUMP_VARIANTS: readonly { readonly name: string; readonly weight: number; readonly lobes: readonly Lobe[] | 'conifer' }[] = [
  { name: 'tall', weight: 0.2, lobes: [{ scale: [0.95, 1.25, 0.95], at: [0, 1.0, 0] }] },
  {
    name: 'pair',
    weight: 0.35,
    lobes: [
      { scale: [1.1, 0.9, 1.1], at: [0, 0.75, 0] },
      { scale: [0.9, 0.9, 0.9], at: [0.9, 0.95, 0.5] },
    ],
  },
  {
    name: 'wide',
    weight: 0.25,
    lobes: [
      { scale: [1.0, 0.8, 1.0], at: [0, 0.65, 0] },
      { scale: [0.85, 0.75, 0.85], at: [1.2, 0.6, 0.3] },
      { scale: [0.8, 0.7, 0.8], at: [-1.0, 0.55, 0.5] },
      { scale: [0.75, 0.8, 0.75], at: [0.2, 0.85, -0.9] },
    ],
  },
  { name: 'conifer', weight: 0.2, lobes: 'conifer' },
];

/** Paints a clump bottom-to-top from shade to light. */
function paintClump(g: BufferGeometry, lit: Color, base: Color, topM: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(base).lerp(lit, clamp((pos.getY(i) - 0.4) / topM, 0, 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/** Lobes of icosahedra with sphere normals (20 faces far away, 80 bumpy ones up close), or a cone. */
function clumpGeometry(lobes: readonly Lobe[] | 'conifer', near: boolean): BufferGeometry {
  if (lobes === 'conifer') {
    const cone = new ConeGeometry(0.85, 3.2, near ? 9 : 6, 1).toNonIndexed();
    cone.translate(0, 1.4, 0);
    cone.computeVertexNormals();
    return paintClump(cone, new Color(PALETTE.conifer.lit), new Color(PALETTE.conifer.base), 2.8);
  }
  const bump = near ? 0.12 : 0;
  const parts = lobes.map((lobe, k) => {
    const g = new IcosahedronGeometry(1, near ? 1 : 0);
    const gp = g.getAttribute('position');
    const gn = g.getAttribute('normal');
    for (let i = 0; i < gp.count; i++) {
      const len = Math.hypot(gp.getX(i), gp.getY(i), gp.getZ(i));
      gn.setXYZ(i, gp.getX(i) / len, gp.getY(i) / len, gp.getZ(i) / len);
      const r = 1 + bump * Math.sin(gp.getX(i) * 7.1 + gp.getZ(i) * 5.3 + k) * Math.cos(gp.getY(i) * 6.7);
      gp.setXYZ(i, gp.getX(i) * r, gp.getY(i) * r, gp.getZ(i) * r);
    }
    g.scale(lobe.scale[0], lobe.scale[1], lobe.scale[2]);
    g.translate(lobe.at[0], lobe.at[1], lobe.at[2]);
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('clump merge failed');
  return paintClump(merged, new Color(PALETTE.foliage.lit), new Color(PALETTE.foliage.base), 2);
}

const HILLS: FbmOptions = { octaves: 4, lacunarity: 2.1, gain: 0.5, frequency: 1 / 420 };
const FOREST: FbmOptions = { octaves: 3, lacunarity: 2, gain: 0.5, frequency: 1 / 260 };

function axis(size: number): number[] {
  const inner: number[] = [];
  for (let v = 0; v <= size; v += BORDER_STEP_M) inner.push(v);
  if (inner[inner.length - 1] !== size) inner.push(size);
  const outer: number[] = [];
  let step = FIRST_STEP_M;
  for (let d = step; d < RING_RADIUS_M; d += step, step *= STEP_GROWTH) outer.push(d);
  outer.push(RING_RADIUS_M);
  return [...outer.map((d) => -d).reverse(), ...inner, ...outer.map((d) => size + d)];
}

const RIVER_BANK_M = 6;
const RIVER_BED_BELOW_LEVEL_M = 1.6;
const CLUMP_WATER_CLEARANCE_M = 8;

export function DistantLandscape({ terrain, seed, water }: { readonly terrain: TerrainData; readonly seed: string; readonly water: readonly WaterBody[] }) {
  const built = useMemo(() => {
    const W = terrain.width * terrain.cellSize;
    const D = terrain.depth * terrain.cellSize;
    const rng = Rng.create(`ring:${seed}`);
    const hills = createSimplex(rng.fork('hills'));
    const forestNoise = createSimplex(rng.fork('forest'));
    const outside = (x: number, z: number) => Math.hypot(Math.max(0, -x, x - W), Math.max(0, -z, z - D));
    /** 0 far from rivers, 1 in a river bed (outside the map only; inside, the map carries them). */
    const rivers = water
      .filter((b) => b.kind === 'river')
      .map((b) => ({ ...b, centerline: extendedRiver(b.centerline) }));
    const riverAt = (x: number, z: number): { carve: number; level: number; distance: number } => {
      let best = { carve: 0, level: 0, distance: Number.POSITIVE_INFINITY };
      for (const body of rivers) {
        const d = projectOnPolyline({ x, z }, body.centerline).distance;
        const half = body.widthM / 2;
        const carve = 1 - smoothstep(half * 0.55, half + RIVER_BANK_M, d);
        if (d < best.distance) best = { carve, level: body.levelM, distance: d - half };
      }
      return best;
    };
    const heightAt = (x: number, z: number): number => {
      const d = outside(x, z);
      const edgeH = sampleHeight(terrain, clamp(x, 0, W), clamp(z, 0, D));
      if (d <= 0) return edgeH - (x > 0 && x < W && z > 0 && z < D ? HIDDEN_DROP_M : 0);
      const amplitude = 4 + 60 * smoothstep(150, 1800, d);
      const far = fbm(hills, x, z, HILLS) * amplitude + amplitude * 0.45;
      // Continue the slope of the map edge (a flat ring after a rising edge reads as a plinth).
      const ex = clamp(x, 0, W);
      const ez = clamp(z, 0, D);
      const ix = clamp(ex + ((ex - x) / d) * EDGE_SLOPE_PROBE_M, 0, W);
      const iz = clamp(ez + ((ez - z) / d) * EDGE_SLOPE_PROBE_M, 0, D);
      const slope = clamp((edgeH - sampleHeight(terrain, ix, iz)) / EDGE_SLOPE_PROBE_M, -EDGE_SLOPE_MAX, EDGE_SLOPE_MAX);
      const continued = edgeH + slope * d * (1 - smoothstep(0, EDGE_SLOPE_FADE_M, d));
      const h = continued + (far - continued) * smoothstep(0, EDGE_BLEND_M, d);
      const river = riverAt(x, z);
      return river.carve > 0 ? h + (river.level - RIVER_BED_BELOW_LEVEL_M - h) * river.carve : h;
    };
    // Massifs separated by clearings (a narrower band than a uniform sprinkle).
    /** Visible surface: the map itself inside, the ring outside (no hidden drop). */
    const surfaceAt = (x: number, z: number): number => (outside(x, z) <= 0 ? sampleHeight(terrain, clamp(x, 0, W), clamp(z, 0, D)) : heightAt(x, z));
    const forestAt = (x: number, z: number) =>
      Math.min(1, smoothstep(0.12, 0.3, fbm(forestNoise, x, z, FOREST)) + EDGE_BELT * (1 - smoothstep(EDGE_BELT_M[0], EDGE_BELT_M[1], outside(x, z))));

    // --- Ring mesh -----------------------------------------------------------------------
    const xs = axis(W);
    const zs = axis(D);
    const positions = new Float32Array(xs.length * zs.length * 3);
    let v = 0;
    for (const z of zs) {
      for (const x of xs) {
        positions[v++] = x;
        positions[v++] = heightAt(x, z);
        positions[v++] = z;
      }
    }
    const indices: number[] = [];
    // Quads well inside the map lie under the terrain: skip them (one border row is kept).
    const hidden = (x0: number, x1: number, z0: number, z1: number) => x0 >= BORDER_STEP_M && x1 <= W - BORDER_STEP_M && z0 >= BORDER_STEP_M && z1 <= D - BORDER_STEP_M;
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) {
        if (hidden(xs[i] as number, xs[i + 1] as number, zs[j] as number, zs[j + 1] as number)) continue;
        const a = j * xs.length + i;
        const b = a + 1;
        const c = a + xs.length;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    // Near the seam, normals from the height function itself (the mesh-only normals crease).
    const nor = geometry.getAttribute('normal');
    for (let i = 0; i < positions.length / 3; i++) {
      const x = positions[i * 3] as number;
      const z = positions[i * 3 + 2] as number;
      if (outside(x, z) > SEAM_NORMALS_M) continue;
      const dx = surfaceAt(x + 1, z) - surfaceAt(x - 1, z);
      const dz = surfaceAt(x, z + 1) - surfaceAt(x, z - 1);
      const len = Math.hypot(dx, 2, dz);
      nor.setXYZ(i, -dx / len, 2 / len, -dz / len);
    }

    // --- Far splat: forest floor under the clumps (stamped once they are placed, below) ------
    const origin = { x: -RING_RADIUS_M, z: -RING_RADIUS_M };
    const size = { x: W + 2 * RING_RADIUS_M, z: D + 2 * RING_RADIUS_M };
    const bytes = new Uint8Array(SPLAT_SIZE * SPLAT_SIZE * 4);
    const stampFloor = (x: number, z: number, radiusM: number) => {
      const ci = ((x - origin.x) / size.x) * SPLAT_SIZE - 0.5;
      const cj = ((z - origin.z) / size.z) * SPLAT_SIZE - 0.5;
      const rt = Math.max(0.75, (radiusM / size.x) * SPLAT_SIZE);
      for (let j = Math.max(0, Math.floor(cj - rt)); j <= Math.min(SPLAT_SIZE - 1, Math.ceil(cj + rt)); j++) {
        for (let i = Math.max(0, Math.floor(ci - rt)); i <= Math.min(SPLAT_SIZE - 1, Math.ceil(ci + rt)); i++) {
          const k = 1 - Math.hypot(i - ci, j - cj) / (rt + 0.5);
          if (k <= 0) continue;
          const tx = origin.x + ((i + 0.5) / SPLAT_SIZE) * size.x;
          const tz = origin.z + ((j + 0.5) / SPLAT_SIZE) * size.z;
          if (outside(tx, tz) <= 0) continue;
          const index = (j * SPLAT_SIZE + i) * 4 + 3;
          bytes[index] = Math.max(bytes[index] as number, Math.round(255 * Math.min(1, k * 1.6)));
        }
      }
    };
    const splat = new DataTexture(bytes, SPLAT_SIZE, SPLAT_SIZE, RGBAFormat, UnsignedByteType);
    splat.magFilter = LinearFilter;
    splat.minFilter = LinearFilter;
    splat.wrapS = ClampToEdgeWrapping;
    splat.wrapT = ClampToEdgeWrapping;
    splat.needsUpdate = true;
    // Same reference height as the map's terrain material (its dryness term depends on it).
    let heightSum = 0;
    for (const h of terrain.heights) heightSum += h;
    const ringMaterial = createTerrainMaterial(splat, size, heightSum / terrain.heights.length, origin, true);
    const ring = new Mesh(geometry, ringMaterial);
    ring.name = 'DistantLandscape';
    ring.receiveShadow = true;

    // --- Forest clumps --------------------------------------------------------------------
    // Four silhouettes (tall lobe, pair, wide group, conifer) in massifs split by clearings.
    // The clumps right past the edge, seen up close, use rounder, bumpier blobs.
    const material = createPaintedMaterial({ name: 'FarClumps', vertexColors: true, heightM: 2.6, gradientBase: 0.7, hueNoiseAmp: 0.05 });
    const meshes = CLUMP_VARIANTS.flatMap((variant) =>
      [false, true].map((near) => {
        const mesh = new InstancedMesh(clumpGeometry(variant.lobes, near), material, near ? NEAR_CLUMPS_MAX : FAR_CLUMPS);
        mesh.name = `FarClumps:${variant.name}${near ? ':near' : ''}`;
        mesh.count = 0;
        return { mesh, near };
      }),
    );
    const totalWeight = CLUMP_VARIANTS.reduce((sum, v) => sum + v.weight, 0);
    const m = new Matrix4();
    const q = new Quaternion();
    const sc = new Vector3();
    const p = new Vector3();
    const up = new Vector3(0, 1, 0);
    let placed = 0;
    let nearPlaced = 0;
    const massifTint = new Color();
    const clumpTint = new Color();
    const conifers = CLUMP_VARIANTS.findIndex((v) => v.lobes === 'conifer');
    // Collected, then written nearest the map first: massifs overlap, and drawing them roughly
    // front to back (the camera is over the map) lets the depth test reject hidden clumps.
    const pending = meshes.map(() => [] as { d: number; matrix: Matrix4; color: Color }[]);
    const floors: { x: number; z: number; r: number }[] = [];
    for (let parent = 0; parent < FAR_CLUMPS * CLUMP_ATTEMPTS && placed < FAR_CLUMPS; parent++) {
      const px = rng.float(-CLUMP_MAX_DIST_M, W + CLUMP_MAX_DIST_M);
      const pz = rng.float(-CLUMP_MAX_DIST_M, D + CLUMP_MAX_DIST_M);
      const pd = outside(px, pz);
      if (pd < CLUMP_MIN_DIST_M || pd > CLUMP_MAX_DIST_M || rng.next() > forestAt(px, pz)) continue;
      // One massif: its own tint and its own share of conifers.
      massifTint.setRGB(1, 1, 1).offsetHSL(rng.float(-0.03, 0.03), rng.float(-0.05, 0.05), rng.float(-0.06, 0.06));
      const coniferShare = rng.chance(0.4) ? 0.5 : 0;
      const children = rng.int(MASSIF_CHILDREN[0], MASSIF_CHILDREN[1]);
      const spread = 5 + 0.02 * pd;
      for (let k = 0; k < children && placed < FAR_CLUMPS; k++) {
        // Gaussian-ish offset (sum of two uniforms).
        const x = px + (rng.next() + rng.next() - 1) * spread * 2;
        const z = pz + (rng.next() + rng.next() - 1) * spread * 2;
        const d = outside(x, z);
        if (d < CLUMP_MIN_DIST_M || d > CLUMP_MAX_DIST_M) continue;
        if (riverAt(x, z).distance < CLUMP_WATER_CLEARANCE_M) continue;
        let index: number;
        if (rng.next() < coniferShare) index = conifers;
        else {
          let pick = rng.next() * totalWeight;
          index = Math.max(0, CLUMP_VARIANTS.findIndex((v) => (pick -= v.weight) < 0));
          if (index === conifers) index = 1;
        }
        const near = d < NEAR_CLUMPS_DIST_M && nearPlaced < NEAR_CLUMPS_MAX;
        const target = pending[index * 2 + (near ? 1 : 0)];
        if (!target) continue;
        const r = rng.next();
        const scale = (1.2 + 3.4 * r * r) * (1 + d / 900);
        const emergent = rng.chance(0.1) ? 1.5 : 1;
        p.set(x, heightAt(x, z) - 0.2 * scale, z);
        q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
        sc.set(scale, scale * rng.float(0.7, 1.3) * emergent, scale);
        target.push({ d, matrix: m.compose(p, q, sc).clone(), color: clumpTint.copy(massifTint).multiplyScalar(rng.float(0.94, 1.06)).clone() });
        floors.push({ x, z, r: scale * CLUMP_FLOOR_RADIUS });
        placed++;
        if (near) nearPlaced++;
      }
    }
    pending.forEach((list, k) => {
      const mesh = meshes[k]?.mesh;
      if (!mesh) return;
      list.sort((a, b) => a.d - b.d);
      for (const item of list) {
        mesh.setMatrixAt(mesh.count, item.matrix);
        mesh.setColorAt(mesh.count, item.color);
        mesh.count++;
      }
    });
    for (const f of floors) stampFloor(f.x, f.z, f.r);
    splat.needsUpdate = true;
    const clumps = meshes.map(({ mesh }) => mesh).filter((mesh) => mesh.count > 0);
    for (const mesh of clumps) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    return { ring, splat, clumps, material, spare: meshes.map(({ mesh }) => mesh) };
  }, [terrain, seed, water]);

  useEffect(
    () => () => {
      built.ring.geometry.dispose();
      (built.ring.material as { dispose(): void }).dispose();
      built.splat.dispose();
      for (const mesh of built.spare) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      built.material.dispose();
    },
    [built],
  );

  return (
    <>
      <primitive object={built.ring} />
      {built.clumps.map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </>
  );
}
