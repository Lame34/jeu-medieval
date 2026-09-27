/**
 * Decorative ring around the playable map (brief §5.4, §7): low-resolution rolling hills whose
 * cells grow with distance, stitched to the map border heights, dressed with cheap forest
 * clumps and swallowed by the aerial fog before the painted mountains of the sky take over.
 * The map edge is never visible.
 */
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, DataTexture, IcosahedronGeometry, InstancedMesh, LinearFilter, Matrix4, Mesh, Quaternion, RGBAFormat, UnsignedByteType, Vector3 } from 'three';
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
const EDGE_BLEND_M = 140;
const SPLAT_SIZE = 256;
const FAR_CLUMPS = 1500;
const CLUMP_MIN_DIST_M = 60;
const CLUMP_MAX_DIST_M = 900;
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
      const h = edgeH + (far - edgeH) * smoothstep(0, EDGE_BLEND_M, d);
      const river = riverAt(x, z);
      return river.carve > 0 ? h + (river.level - RIVER_BED_BELOW_LEVEL_M - h) * river.carve : h;
    };
    const forestAt = (x: number, z: number) => smoothstep(0.02, 0.25, fbm(forestNoise, x, z, FOREST));

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

    // --- Far splat: forest floor where the clumps grow --------------------------------------
    const origin = { x: -RING_RADIUS_M, z: -RING_RADIUS_M };
    const size = { x: W + 2 * RING_RADIUS_M, z: D + 2 * RING_RADIUS_M };
    const bytes = new Uint8Array(SPLAT_SIZE * SPLAT_SIZE * 4);
    for (let j = 0; j < SPLAT_SIZE; j++) {
      for (let i = 0; i < SPLAT_SIZE; i++) {
        const x = origin.x + ((i + 0.5) / SPLAT_SIZE) * size.x;
        const z = origin.z + ((j + 0.5) / SPLAT_SIZE) * size.z;
        bytes[(j * SPLAT_SIZE + i) * 4 + 3] = outside(x, z) > 0 ? Math.round(forestAt(x, z) * 255) : 0;
      }
    }
    const splat = new DataTexture(bytes, SPLAT_SIZE, SPLAT_SIZE, RGBAFormat, UnsignedByteType);
    splat.magFilter = LinearFilter;
    splat.minFilter = LinearFilter;
    splat.wrapS = ClampToEdgeWrapping;
    splat.wrapT = ClampToEdgeWrapping;
    splat.needsUpdate = true;
    const ringMaterial = createTerrainMaterial(splat, size, 4, origin);
    const ring = new Mesh(geometry, ringMaterial);
    ring.name = 'DistantLandscape';
    ring.receiveShadow = true;

    // --- Forest clumps --------------------------------------------------------------------
    // Two soft blobs per clump, sitting on the ground: 20-face icosahedra with sphere normals
    // (smooth shading, and the polygonal silhouette is lost in the distance and the haze).
    const clumpParts = [0, 1].map((k) => {
      const g = new IcosahedronGeometry(1, 0);
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      for (let i = 0; i < pos.count; i++) {
        const len = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
        nor.setXYZ(i, pos.getX(i) / len, pos.getY(i) / len, pos.getZ(i) / len);
      }
      g.scale(1.1 - k * 0.2, 0.9, 1.1 - k * 0.2);
      g.translate(k === 0 ? 0 : 0.9, 0.75 + k * 0.2, k === 0 ? 0 : 0.5);
      return g.index ? g.toNonIndexed() : g;
    });
    const clump = mergeGeometries(clumpParts, false);
    clumpParts.forEach((g) => g.dispose());
    if (!clump) throw new Error('clump merge failed');
    const lit = new Color(PALETTE.foliage.lit);
    const base = new Color(PALETTE.foliage.base);
    const pos = clump.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = base.clone().lerp(lit, clamp((pos.getY(i) - 0.4) / 2, 0, 1));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    clump.setAttribute('color', new BufferAttribute(colors, 3));
    const clumpMaterial = createPaintedMaterial({ name: 'FarClumps', vertexColors: true, heightM: 2.6, gradientBase: 0.7, hueNoiseAmp: 0.05 });
    const clumps = new InstancedMesh(clump, clumpMaterial, FAR_CLUMPS);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    const p = new Vector3();
    const up = new Vector3(0, 1, 0);
    let placed = 0;
    for (let attempt = 0; attempt < FAR_CLUMPS * 12 && placed < FAR_CLUMPS; attempt++) {
      const x = rng.float(-CLUMP_MAX_DIST_M, W + CLUMP_MAX_DIST_M);
      const z = rng.float(-CLUMP_MAX_DIST_M, D + CLUMP_MAX_DIST_M);
      const d = outside(x, z);
      if (d < CLUMP_MIN_DIST_M || d > CLUMP_MAX_DIST_M) continue;
      if (rng.next() > forestAt(x, z)) continue;
      if (riverAt(x, z).distance < CLUMP_WATER_CLEARANCE_M) continue;
      const scale = rng.float(2.2, 3.4) * (1 + d / 900);
      p.set(x, heightAt(x, z) - 0.2 * scale, z);
      q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
      s.set(scale, scale * rng.float(0.85, 1.2), scale);
      clumps.setMatrixAt(placed++, m.compose(p, q, s));
    }
    clumps.count = placed;
    clumps.instanceMatrix.needsUpdate = true;
    clumps.computeBoundingSphere();
    clumps.name = 'FarClumps';
    return { ring, splat, clumps };
  }, [terrain, seed, water]);

  useEffect(
    () => () => {
      built.ring.geometry.dispose();
      (built.ring.material as { dispose(): void }).dispose();
      built.splat.dispose();
      built.clumps.geometry.dispose();
      (built.clumps.material as { dispose(): void }).dispose();
      built.clumps.dispose();
    },
    [built],
  );

  return (
    <>
      <primitive object={built.ring} />
      <primitive object={built.clumps} />
    </>
  );
}
