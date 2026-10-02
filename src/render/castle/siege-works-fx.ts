/**
 * Sappers' works on screen (J4): fascine bundles piling up in a moat slot turn after turn until
 * they lie level with the causeway, and at a wall's foot the sappers' timber shed with a heap of
 * spoil growing beside it. Built when a work progresses (never per frame).
 */
import { Color, CylinderGeometry, Euler, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../../core/math/vec2.ts';
import { PALETTE } from '../materials/palette.ts';
import { boxGeometry, finish } from './castle-geometry.ts';
import { hash01 } from './siege-fx.ts';

/** A fascine: a bundle of brushwood (m). */
const BUNDLE_LENGTH_M = 2.6;
const BUNDLE_RADIUS_M = 0.32;
/** Bundles per cell of the slot in the top layer; how deep the pile shows under the surface. */
const BUNDLES_PER_CELL = 0.55;
const PILE_SHOWS_M = 1.6;

/** One bundle, its axis along +x, painted brushwood with two bindings. */
export function bundleGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const brush = new Color(PALETTE.woodLight.lit).lerp(new Color('#9a8a52'), 0.45);
  const binding = new Color(PALETTE.woodWarm.base);
  const body = new CylinderGeometry(BUNDLE_RADIUS_M, BUNDLE_RADIUS_M * 0.92, BUNDLE_LENGTH_M, 7, 1, false).rotateZ(Math.PI / 2);
  parts.push(finish(body.toNonIndexed(), -2, brush));
  body.dispose();
  for (const x of [-0.7, 0.7]) {
    const band = new CylinderGeometry(BUNDLE_RADIUS_M * 1.06, BUNDLE_RADIUS_M * 1.06, 0.14, 7, 1, false).rotateZ(Math.PI / 2).translate(x, 0, 0);
    parts.push(finish(band.toNonIndexed(), -2, binding));
    band.dispose();
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('fascine merge failed');
  return merged;
}

/**
 * Bundles for a slot at `fraction` of its work: the top of the pile rises from the ditch bed to
 * the causeway surface. `cells` are the slot's cells (x, z centres), `tangent` the moat's
 * direction there (bundles lie along it).
 */
export function placeBundles(mesh: InstancedMesh, cells: readonly Vec2[], tangent: Vec2, surfaceM: number, bedM: number, fraction: number, seed: number): void {
  const top = bedM + (surfaceM - bedM) * Math.min(1, fraction);
  const yaw = Math.atan2(-tangent.z, tangent.x);
  const q = new Quaternion();
  const m = new Matrix4();
  const p = new Vector3();
  const s = new Vector3(1, 1, 1);
  let n = 0;
  const layers = Math.max(1, Math.ceil(Math.min(PILE_SHOWS_M, top - bedM) / (BUNDLE_RADIUS_M * 1.6)));
  for (let layer = 0; layer < layers && n < mesh.instanceMatrix.count; layer++) {
    const y = top - BUNDLE_RADIUS_M * 0.75 - layer * BUNDLE_RADIUS_M * 1.6;
    cells.forEach((c, k) => {
      if (n >= mesh.instanceMatrix.count || hash01(seed, k, layer) > BUNDLES_PER_CELL) return;
      q.setFromEuler(EULER.set((hash01(seed, k, layer + 11) - 0.5) * 0.25, yaw + (hash01(seed, k, layer + 23) - 0.5) * 0.5, 0));
      p.set(c.x + (hash01(seed, k, layer + 31) - 0.5) * 0.6, y, c.z + (hash01(seed, k, layer + 37) - 0.5) * 0.6);
      m.compose(p, q, s);
      mesh.setMatrixAt(n++, m);
    });
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
}

/** Upper bound of instances a slot of `cells` cells can need. */
export function bundleCapacity(cells: number): number {
  return Math.ceil(cells * BUNDLES_PER_CELL * (PILE_SHOWS_M / (BUNDLE_RADIUS_M * 1.6) + 1)) + 4;
}

/**
 * The sappers' shed at a wall's foot (a sloping roof of planks on four posts, its back to the
 * wall) and, beside it, a heap of spoil that grows with the work. World space; `out` points away
 * from the wall.
 */
export function mineGeometry(at: Vec2, groundM: number, out: Vec2, fraction: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const yaw = Math.atan2(out.x, out.z);
  const wood = new Color(PALETTE.woodWarm.lit);
  const plank = new Color(PALETTE.woodLight.base);
  const earth = new Color('#7a6248');
  const local = (x: number, z: number) => new Vector3(at.x + Math.cos(yaw) * x + Math.sin(yaw) * z, 0, at.z - Math.sin(yaw) * x + Math.cos(yaw) * z);
  for (const [x, z, h] of [
    [-1, -0.9, 2.2],
    [1, -0.9, 2.2],
    [-1, 0.9, 1.4],
    [1, 0.9, 1.4],
  ] as const) {
    const c = local(x, z).setY(groundM + h / 2);
    parts.push(finish(boxGeometry({ center: c, size: new Vector3(0.18, h, 0.18), yaw: -yaw }), groundM, wood));
  }
  for (let k = 0; k < 5; k++) {
    const z = -0.9 + (k + 0.5) * 0.4;
    const c = local(0, z).setY(groundM + 2.25 - (k + 0.5) * 0.17);
    parts.push(finish(boxGeometry({ center: c, size: new Vector3(2.4, 0.07, 0.38), yaw: -yaw }), groundM, plank.clone().multiplyScalar(0.9 + 0.2 * hash01(k, 3))));
  }
  // Spoil heap: a few flattened mounds, taller as the gallery deepens.
  const heap = 0.25 + 0.9 * Math.min(1, fraction);
  for (let k = 0; k < 4; k++) {
    const c = local(1.9 + 0.5 * hash01(k, 5), 1.0 + 1.2 * hash01(k, 7)).setY(groundM + heap * 0.3);
    const mound = new CylinderGeometry(0.15, 0.9 + 0.3 * hash01(k, 9), heap * (0.6 + 0.4 * hash01(k, 11)), 8, 1, false).translate(c.x, c.y, c.z);
    parts.push(finish(mound.toNonIndexed(), groundM, earth.clone().multiplyScalar(0.92 + 0.15 * hash01(k, 13))));
    mound.dispose();
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('mine merge failed');
  return merged;
}

export function createBundleMesh(material: Material, capacity: number, name: string): InstancedMesh {
  const mesh = new InstancedMesh(bundleGeometry(), material, Math.max(1, capacity));
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

const EULER = new Euler();
