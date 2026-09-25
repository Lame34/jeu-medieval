/**
 * Hedges and dry-stone walls along field borders (brief §5.4): hedges are dense rows of leafy
 * blobs (one InstancedMesh), dry-stone walls a low masonry run sharing the castle stone shader
 * (one merged mesh). Both follow the terrain.
 */
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../../core/math/vec2.ts';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { pointAlong, polylineLength } from '../../core/worldgen/geometry.ts';
import type { HedgeLine } from '../../core/worldgen/types.ts';
import { createStoneMaterial } from '../castle/stone-material.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { buildTreeGeometry } from '../vegetation/tree-geometry.ts';

const HEDGE_STEP_M = 0.9;
const HEDGE_HEIGHT_M = 1.7;
const HEDGE_WIND_M = 0.05;
const WALL_HEIGHT_M = 1.0;
const WALL_THICKNESS_M = 0.7;
const WALL_STEP_M = 1.5;
const DRY_STONE_COURSE_M = 0.26;
const UP = new Vector3(0, 1, 0);

function wallSegment(a: Vec2, b: Vec2, terrain: TerrainData, along0: number): BufferGeometry {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  const nx = -dz * (WALL_THICKNESS_M / 2);
  const nz = dx * (WALL_THICKNESS_M / 2);
  const ha = sampleHeight(terrain, a.x, a.z);
  const hb = sampleHeight(terrain, b.x, b.z);
  const bury = 0.4;
  // Slightly tapered profile: wider at the base, rounded cap.
  const top = 0.75;
  const corners = (h: number, p: Vec2) => [
    [p.x - nx, h - bury, p.z - nz],
    [p.x + nx, h - bury, p.z + nz],
    [p.x + nx * top, h + WALL_HEIGHT_M, p.z + nz * top],
    [p.x - nx * top, h + WALL_HEIGHT_M, p.z - nz * top],
  ];
  const A = corners(ha, a);
  const B = corners(hb, b);
  const quads = [
    [A[0], B[0], B[3], A[3]],
    [B[1], A[1], A[2], B[2]],
    [A[3], B[3], B[2], A[2]],
  ];
  const positions: number[] = [];
  for (const [p0, p1, p2, p3] of quads) for (const v of [p0, p1, p2, p0, p2, p3]) positions.push(...(v as number[]));
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  const count = positions.length / 3;
  const data = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3).fill(1);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] as number;
    const y = positions[i * 3 + 1] as number;
    const z = positions[i * 3 + 2] as number;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len));
    data[i * 4] = y - (ha + (hb - ha) * t);
    data[i * 4 + 3] = along0 + t * len;
  }
  g.setAttribute('aPaintedData', new BufferAttribute(data, 4));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  return g;
}

export function Hedges({ hedges, terrain }: { readonly hedges: readonly HedgeLine[]; readonly terrain: TerrainData }) {
  const built = useMemo(() => {
    const rng = Rng.create('hedges');
    const spots: { p: Vec2; s: number; r: number }[] = [];
    const walls: BufferGeometry[] = [];
    let along = 0;
    for (const hedge of hedges) {
      const len = polylineLength(hedge.points);
      if (hedge.kind === 'hedge') {
        for (let s = 0; s <= len; s += HEDGE_STEP_M * rng.float(0.8, 1.2)) spots.push({ p: pointAlong(hedge.points, s), s: rng.float(0.8, 1.25), r: rng.next() });
      } else {
        for (let s = 0; s < len; s += WALL_STEP_M) {
          const a = pointAlong(hedge.points, s);
          const b = pointAlong(hedge.points, Math.min(len, s + WALL_STEP_M));
          if (Math.hypot(b.x - a.x, b.z - a.z) > 0.05) walls.push(wallSegment(a, b, terrain, along + s));
        }
        along += len;
      }
    }
    const meshes: (InstancedMesh | Mesh)[] = [];
    const disposables: { dispose(): void }[] = [];
    if (spots.length > 0) {
      const geometry = buildTreeGeometry('bush', 1);
      const material = createPaintedMaterial({ name: 'Hedge', vertexColors: true, heightM: HEDGE_HEIGHT_M, windSwayM: HEDGE_WIND_M, gradientBase: 0.72, foliage: true });
      const mesh = new InstancedMesh(geometry, material, spots.length);
      const m = new Matrix4();
      const q = new Quaternion();
      const sc = new Vector3();
      const pos = new Vector3();
      const tint = new Color();
      spots.forEach((spot, i) => {
        pos.set(spot.p.x, sampleHeight(terrain, spot.p.x, spot.p.z) - 0.15, spot.p.z);
        q.setFromAxisAngle(UP, spot.r * Math.PI * 2);
        sc.set(spot.s * 0.9, spot.s * 1.3, spot.s * 0.9);
        mesh.setMatrixAt(i, m.compose(pos, q, sc));
        mesh.setColorAt(i, tint.setRGB(0.92 + 0.12 * spot.r, 0.95 + 0.08 * spot.s, 0.9));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Hedges';
      meshes.push(mesh);
      disposables.push(geometry, material);
    }
    if (walls.length > 0) {
      const geometry = mergeGeometries(walls, false);
      walls.forEach((w) => w.dispose());
      if (geometry) {
        const material = createStoneMaterial(WALL_HEIGHT_M, DRY_STONE_COURSE_M);
        const mesh = new Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'DryStoneWalls';
        meshes.push(mesh);
        disposables.push(geometry, material);
      }
    }
    return { meshes, disposables };
  }, [hedges, terrain]);

  useEffect(() => () => built.disposables.forEach((d) => d.dispose()), [built]);

  return (
    <>
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}
