/**
 * Sappers' works on screen (J4): fascine bundles piling up in a moat slot turn after turn until
 * they lie level with the causeway, and at a wall's foot the sappers' timber shed with a heap of
 * spoil growing beside it. Built when a work progresses (never per frame).
 */
import { Color, CylinderGeometry, Euler, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferAttribute, type BufferGeometry, type Material } from 'three';
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
/** How far (× radius) the top bundles sink below the pile's top. */
const FASCINE_SINK = 0.4;
/** A faggot, not a rolled rug (review J4): splayed ends, a ragged outline, cut ends showing. */
const BUNDLE_FLARE = 1.2;
const BUNDLE_RAGGED = 0.12;
const BRUSH_TOP = '#7f7048';
const BRUSH_BASE = '#57492f';
const BRUSH_CUT = '#b39b6a';
const BINDING_COLOR = '#3a2a1c';
const BINDING_WIDTH_M = 0.08;
/** A finished causeway: a strip of tamped earth over the bundles, level with the banks. */
const CAUSEWAY_EARTH = '#9c7a52';
const CAUSEWAY_THICKNESS_M = 0.05;
/** The trodden strip covers this share of the slot's length: the bundles show either side. */
const CAUSEWAY_SHARE = 0.55;
const CAUSEWAY_RISE_M = 0.04;
/** The mine: spoil (colour, heaps, height and spread grow with the work), shed, gallery mouth. */
const SPOIL_COLOR = '#9c7a52';
const SPOIL_HEAPS = 3;
const SHED_HIDE = '#8a6444';
const GALLERY_COLOR = '#2a2226';
const GALLERY_WIDTH_M = 1.3;

/** One bundle, its axis along +x: brushwood darker underneath, pale cut ends, two bindings. */
export function bundleGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const top = new Color(BRUSH_TOP);
  const base = new Color(BRUSH_BASE);
  const cut = new Color(BRUSH_CUT);
  const half = BUNDLE_LENGTH_M / 2;
  // Built along y, then laid along x.
  const body = new CylinderGeometry(BUNDLE_RADIUS_M, BUNDLE_RADIUS_M * 0.92, BUNDLE_LENGTH_M, 6, 3, false);
  const pos = body.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.hypot(x, z) < 1e-4) continue;
    // Same displacement for coincident vertices (side ring and cap rim): hashed from angle and height.
    const key = Math.round(Math.atan2(z, x) * 100);
    const ring = Math.round(y * 100);
    const k = (Math.abs(y) > half - 1e-3 ? BUNDLE_FLARE : 1) * (1 + (hash01(key, ring, 3) - 0.5) * 2 * BUNDLE_RAGGED);
    pos.setXYZ(i, x * k, y, z * k);
  }
  const laid = body.toNonIndexed().rotateZ(Math.PI / 2);
  body.dispose();
  laid.computeVertexNormals();
  const finished = finish(laid, -2, top);
  const colors = finished.getAttribute('color') as BufferAttribute;
  const normals = finished.getAttribute('normal');
  const p2 = finished.getAttribute('position');
  const reach = BUNDLE_RADIUS_M * BUNDLE_FLARE * (1 + BUNDLE_RAGGED);
  const c = new Color();
  for (let i = 0; i < p2.count; i++) {
    if (Math.abs(normals.getX(i)) > 0.95) c.copy(cut);
    else c.copy(base).lerp(top, Math.min(1, Math.max(0, p2.getY(i) / reach * 0.5 + 0.5)));
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  parts.push(finished);
  for (const x of [-0.7, 0.7]) {
    const band = new CylinderGeometry(BUNDLE_RADIUS_M * 1.1, BUNDLE_RADIUS_M * 1.1, BINDING_WIDTH_M, 6, 1, false).rotateZ(Math.PI / 2).translate(x, 0, 0);
    parts.push(finish(band.toNonIndexed(), -2, new Color(BINDING_COLOR)));
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
    // The top layer sits in the water, not on it.
    const y = top - BUNDLE_RADIUS_M * (0.75 + FASCINE_SINK) - layer * BUNDLE_RADIUS_M * 1.6;
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

/**
 * The tamped earth of a finished causeway: one strip across the moat over the slot (world space),
 * `tangent` the moat's direction; its ends run into the banks.
 */
export function causewayGeometry(cells: readonly Vec2[], tangent: Vec2, surfaceM: number): BufferGeometry {
  const centre = cells.reduce((a, c) => ({ x: a.x + c.x / cells.length, z: a.z + c.z / cells.length }), { x: 0, z: 0 });
  const across = { x: -tangent.z, z: tangent.x };
  let halfAlong = 0;
  let halfAcross = 0;
  for (const c of cells) {
    halfAlong = Math.max(halfAlong, Math.abs((c.x - centre.x) * tangent.x + (c.z - centre.z) * tangent.z));
    halfAcross = Math.max(halfAcross, Math.abs((c.x - centre.x) * across.x + (c.z - centre.z) * across.z));
  }
  const geometry = finish(
    boxGeometry({
      center: new Vector3(centre.x, surfaceM + CAUSEWAY_RISE_M, centre.z),
      size: new Vector3((halfAlong + 0.3) * 2 * CAUSEWAY_SHARE, CAUSEWAY_THICKNESS_M, (halfAcross + 0.5) * 2),
      yaw: Math.atan2(-tangent.z, tangent.x),
    }),
    surfaceM - 1,
    new Color(CAUSEWAY_EARTH),
  );
  return geometry;
}

/** Upper bound of instances a slot of `cells` cells can need. */
export function bundleCapacity(cells: number): number {
  return Math.ceil(cells * BUNDLES_PER_CELL * (PILE_SHOWS_M / (BUNDLE_RADIUS_M * 1.6) + 1)) + 4;
}

/**
 * The sappers' shed at a wall's foot (a sloping roof of planks under a hide on four posts, its
 * back to the wall), the gallery's mouth in the wall behind it, deepening with the work, and
 * beside it heaps of spoil that grow with the work. World space; `out` points away from the
 * wall, which stands `wallM` behind `at`.
 */
export function mineGeometry(at: Vec2, groundM: number, out: Vec2, fraction: number, wallM: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const yaw = Math.atan2(out.x, out.z);
  const wood = new Color(PALETTE.woodWarm.lit);
  const plank = new Color(PALETTE.woodLight.base);
  const earth = new Color(SPOIL_COLOR);
  const f = Math.min(1, fraction);
  const local = (x: number, z: number) => new Vector3(at.x + Math.cos(yaw) * x + Math.sin(yaw) * z, 0, at.z - Math.sin(yaw) * x + Math.cos(yaw) * z);
  for (const [x, z, h] of [
    [-1, -0.9, 2.0],
    [1, -0.9, 2.0],
    [-1, 0.9, 1.0],
    [1, 0.9, 1.0],
  ] as const) {
    const c = local(x, z).setY(groundM + h / 2);
    parts.push(finish(boxGeometry({ center: c, size: new Vector3(0.18, h, 0.18), yaw: -yaw }), groundM, wood));
  }
  const hide = new Color(SHED_HIDE);
  for (let k = 0; k < 5; k++) {
    const z = -0.9 + (k + 0.5) * 0.4;
    const y = groundM + 2.05 - (k + 0.5) * 0.2;
    parts.push(finish(boxGeometry({ center: local(0, z).setY(y), size: new Vector3(2.4, 0.07, 0.38), yaw: -yaw }), groundM, plank.clone().multiplyScalar(0.9 + 0.2 * hash01(k, 3))));
    // The hide thrown over the planks (against fire and stones).
    parts.push(finish(boxGeometry({ center: local(0, z).setY(y + 0.05), size: new Vector3(2.6, 0.03, 0.46), yaw: -yaw }), groundM, hide.clone().multiplyScalar(0.92 + 0.12 * hash01(k, 4))));
  }
  // The gallery's mouth at the wall's foot, higher as it is dug.
  const mouthH = 0.5 + 0.6 * f;
  parts.push(finish(boxGeometry({ center: local(0, -Math.max(1.0, wallM) + 0.03).setY(groundM + mouthH / 2), size: new Vector3(GALLERY_WIDTH_M, mouthH, 0.06), yaw: -yaw }), groundM, new Color(GALLERY_COLOR)));
  // Spoil: flattened heaps, taller and wider as the gallery deepens.
  // One heap a turn of work: 0.35, 0.7, 1 m.
  const heap = 0.35 + 0.65 * f;
  for (let k = 0; k < SPOIL_HEAPS; k++) {
    const c = local(1.9 + 0.9 * hash01(k, 5), 0.4 + 2.0 * hash01(k, 7)).setY(groundM + heap * 0.3);
    const mound = new CylinderGeometry(0.15, 1.1 + 0.5 * hash01(k, 9), heap * (0.6 + 0.4 * hash01(k, 11)), 8, 1, false).translate(c.x, c.y, c.z);
    parts.push(finish(mound.toNonIndexed(), groundM - 1, earth.clone().multiplyScalar(0.92 + 0.15 * hash01(k, 13))));
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
