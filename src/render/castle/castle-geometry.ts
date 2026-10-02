/**
 * Procedural castle kit (brief §6.2): curtain walls extruded along a path with a wall-walk and
 * merlons, cylindrical towers with crenellations and a conical roof. Geometry carries
 * `aPaintedData.x` = height above the wall base (for moss, streaks and the vertical gradient).
 */
import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { TowerSite, WallRun } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';

export const BURY_M = 2;
/** Battered foot of curtain walls (m): height on the face, spread outwards. */
const TALUS_HEIGHT_M = 0.9;
const TALUS_SPREAD_M = 0.35;
/** The slope continues under the wall base so uneven ground never shows its underside. */
const TALUS_FOOT_DEPTH_M = 1.2;
/** Ragged ends left either side of a breach: steps (m into the gap) and their heights (× wall). */
const BREACH_STEP_M = 0.7;
const BREACH_STEPS = [0.72, 0.46, 0.22] as const;
/** Pier capping a free wall end (m). */
const END_PIER_LENGTH_M = 1.4;
const END_PIER_EXTRA_M = 1.2;
const END_PIER_WIDEN_M = 0.5;
const MERLON_WIDTH_M = 0.85;
const MERLON_GAP_M = 0.6;
const MERLON_HEIGHT_M = 1.05;
const MERLON_DEPTH_M = 0.55;
const PARAPET_HEIGHT_M = 0.45;
const TOWER_SIDES = 18;
const TOWER_MERLONS = 12;
const TOWER_ROOF_RATIO = 0.95;
const ROOF_OVERHANG_M = 0.8;
export const ROOF_COLOR = PALETTE.towerRoof;
export const ROOF_SHINGLE_ROWS = 14;
const GLACIS_HEIGHT_M = 1.4;
const GLACIS_FLARE_M = 0.8;
const FINIAL_HEIGHT_M = 1.3;
const FINIAL_COLOR = '#4a4f57';

export interface Box {
  readonly center: Vector3;
  readonly size: Vector3;
  readonly yaw: number;
}

export function boxGeometry(box: Box): BufferGeometry {
  // Hand-built box (no shared normals between faces: crisp masonry edges).
  const { x: sx, y: sy, z: sz } = box.size;
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces: [Vector3, Vector3, Vector3, Vector3][] = [
    [new Vector3(hx, -hy, hz), new Vector3(hx, -hy, -hz), new Vector3(hx, hy, -hz), new Vector3(hx, hy, hz)],
    [new Vector3(-hx, -hy, -hz), new Vector3(-hx, -hy, hz), new Vector3(-hx, hy, hz), new Vector3(-hx, hy, -hz)],
    [new Vector3(-hx, hy, hz), new Vector3(hx, hy, hz), new Vector3(hx, hy, -hz), new Vector3(-hx, hy, -hz)],
    [new Vector3(-hx, -hy, hz), new Vector3(hx, -hy, hz), new Vector3(hx, hy, hz), new Vector3(-hx, hy, hz)],
    [new Vector3(hx, -hy, -hz), new Vector3(-hx, -hy, -hz), new Vector3(-hx, hy, -hz), new Vector3(hx, hy, -hz)],
  ];
  const positions: number[] = [];
  for (const [a, b, c, d] of faces) for (const p of [a, b, c, a, c, d]) positions.push(p.x, p.y, p.z);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  g.applyMatrix4(new Matrix4().makeRotationY(box.yaw).setPosition(box.center));
  return g;
}

/** Horizontal masonry coordinate of a vertex (arc length along the wall / around the tower). */
export type AlongFn = (x: number, z: number) => number;

export function finish(g: BufferGeometry, baseY: number, color: Color, along?: AlongFn): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const pos = out.getAttribute('position');
  const data = new Float32Array(pos.count * 4);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    data[i * 4] = pos.getY(i) - baseY;
    data[i * 4 + 3] = along ? along(pos.getX(i), pos.getZ(i)) : 0;
    colors.set([color.r, color.g, color.b], i * 3);
  }
  out.setAttribute('aPaintedData', new BufferAttribute(data, 4));
  out.setAttribute('color', new BufferAttribute(colors, 3));
  // Uniform attribute set (merge requirement); stone is textured procedurally, not by UV.
  out.setAttribute('uv', new BufferAttribute(new Float32Array(pos.count * 2), 2));
  return out;
}

function segmentYaw(a: Vec2, b: Vec2): number {
  return Math.atan2(-(b.z - a.z), b.x - a.x);
}

/**
 * `paintBaseM`: height the masonry treatment counts from (moss, streaks); defaults to the wall
 * base. A gate lintel starts above the opening but belongs to the wall below it.
 * `footing`: battered talus along the outer foot and end piers on an open run (curtain walls;
 * not lintels or keep walls). `breached`: segments (index k, from points[k]) brought down by the
 * siege, drawn as ragged stumps at both ends of the gap.
 */
export function buildWallGeometry(wall: WallRun, paintBaseM = wall.baseHeightM, footing = true, breached: ReadonlySet<number> = NO_BREACH): BufferGeometry {
  const stone = new Color('#ffffff');
  const parts: BufferGeometry[] = [];
  const alongs: AlongFn[] = [];
  const base = wall.baseHeightM;
  let travelled = 0;
  for (let i = 0; i < wall.points.length - 1; i++) {
    const a = wall.points[i] as Vec2;
    const b = wall.points[i + 1] as Vec2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = segmentYaw(a, b);
    const mid = new Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    const bodyH = wall.heightM + BURY_M;
    const dir = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const outwardDir = new Vector3(dir.z, 0, -dir.x);
    const segmentStart = travelled;
    // Along the wall plus across it: courses continue round the end faces (no vertical smear).
    const along: AlongFn = (x, z) => segmentStart + (x - a.x) * dir.x + (z - a.z) * dir.z + (x - a.x) * outwardDir.x + (z - a.z) * outwardDir.z;
    const before = parts.length;
    if (breached.has(i)) {
      // Breached: only ragged stumps stepping down into the gap from each end.
      for (const [end, sign] of [
        [a, 1],
        [b, -1],
      ] as const) {
        BREACH_STEPS.forEach((ratio, k) => {
          const h = wall.heightM * ratio + BURY_M;
          const c = new Vector3(end.x, base - BURY_M + h / 2, end.z).addScaledVector(dir, sign * (wall.thicknessM / 2 + BREACH_STEP_M * (k + 0.5)));
          parts.push(boxGeometry({ center: c, size: new Vector3(BREACH_STEP_M, h, wall.thicknessM * (1 - 0.08 * k)), yaw }));
        });
      }
      for (let k = before; k < parts.length; k++) alongs.push(along);
      travelled += len;
      continue;
    }
    // Body, extended by half the thickness so consecutive segments overlap at the joints.
    parts.push(boxGeometry({ center: mid.clone().setY(base - BURY_M + bodyH / 2), size: new Vector3(len + wall.thicknessM, bodyH, wall.thicknessM), yaw }));
    // Outer merlons and inner parapet along the wall-walk.
    const outward = new Vector3(dir.z, 0, -dir.x);
    const count = Math.floor(len / (MERLON_WIDTH_M + MERLON_GAP_M));
    const start = -((count - 1) * (MERLON_WIDTH_M + MERLON_GAP_M)) / 2;
    for (let k = 0; k < count; k++) {
      const along = start + k * (MERLON_WIDTH_M + MERLON_GAP_M);
      const c = mid
        .clone()
        .addScaledVector(dir, along)
        .addScaledVector(outward, wall.thicknessM / 2 - MERLON_DEPTH_M / 2)
        .setY(base + wall.heightM + MERLON_HEIGHT_M / 2);
      parts.push(boxGeometry({ center: c, size: new Vector3(MERLON_WIDTH_M, MERLON_HEIGHT_M, MERLON_DEPTH_M), yaw }));
    }
    const parapet = mid.clone().addScaledVector(outward, -wall.thicknessM / 2 + 0.15).setY(base + wall.heightM + PARAPET_HEIGHT_M / 2);
    parts.push(boxGeometry({ center: parapet, size: new Vector3(len, PARAPET_HEIGHT_M, 0.3), yaw }));
    if (footing) parts.push(talusGeometry(a, b, outward, wall.thicknessM, base));
    for (let k = before; k < parts.length; k++) alongs.push(along);
    travelled += len;
  }
  // End piers on an open run: a free wall end is capped, never cut.
  const first = wall.points[0] as Vec2;
  const last = wall.points[wall.points.length - 1] as Vec2;
  if (footing && (first.x !== last.x || first.z !== last.z)) {
    for (const [end, next] of [
      [first, wall.points[1] as Vec2],
      [last, wall.points[wall.points.length - 2] as Vec2],
    ] as const) {
      const yaw = segmentYaw(end, next);
      const dir = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const h = wall.heightM + END_PIER_EXTRA_M + BURY_M;
      const c = new Vector3(end.x, base - BURY_M + h / 2, end.z).addScaledVector(dir, END_PIER_LENGTH_M / 2 - wall.thicknessM / 2);
      parts.push(boxGeometry({ center: c, size: new Vector3(END_PIER_LENGTH_M, h, wall.thicknessM + END_PIER_WIDEN_M), yaw }));
      const pierAlong: AlongFn = (x, z) => (x - end.x) * dir.z - (z - end.z) * dir.x + (x - end.x) * dir.x + (z - end.z) * dir.z;
      alongs.push(pierAlong);
    }
  }
  const merged = mergeGeometries(parts.map((p, k) => finish(p, paintBaseM, stone, alongs[k])), false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error('wall merge failed');
  return merged;
}

const NO_BREACH: ReadonlySet<number> = new Set();

/**
 * Solid bands standing in for the merlons in the shadow pass (drawn invisible in the view): the merlons themselves cast a
 * comb of 0.6 m slits that the shadow map renders as crawling 1–3 px streaks; a painter would
 * lay the parapet's shadow as one band.
 */
export function buildCrenelShadowProxy(walls: readonly WallRun[], towers: readonly TowerSite[], breached: (wallId: string, k: number) => boolean = () => false): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  for (const wall of walls) {
    for (let i = 0; i < wall.points.length - 1; i++) {
      if (breached(wall.id, i)) continue;
      const a = wall.points[i] as Vec2;
      const b = wall.points[i + 1] as Vec2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = segmentYaw(a, b);
      const dir = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const outward = new Vector3(dir.z, 0, -dir.x);
      const c = new Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2)
        .addScaledVector(outward, wall.thicknessM / 2 - MERLON_DEPTH_M / 2)
        .setY(wall.baseHeightM + wall.heightM + MERLON_HEIGHT_M / 2);
      parts.push(boxGeometry({ center: c, size: new Vector3(len + wall.thicknessM, MERLON_HEIGHT_M, MERLON_DEPTH_M), yaw }));
    }
  }
  for (const tower of towers) {
    const ring = new CylinderGeometry(tower.radiusM + 0.35, tower.radiusM + 0.35, MERLON_HEIGHT_M, TOWER_SIDES, 1, true);
    ring.deleteAttribute('uv');
    ring.translate(tower.center.x, tower.baseHeightM + tower.heightM + MERLON_HEIGHT_M / 2, tower.center.z);
    parts.push(ring.toNonIndexed());
    ring.dispose();
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Battered talus along the outer foot of a wall segment: a sloped band that anchors it. */
function talusGeometry(a: Vec2, b: Vec2, outward: Vector3, thickness: number, base: number): BufferGeometry {
  const face = thickness / 2;
  const at = (p: Vec2, off: number, y: number) => [p.x + outward.x * off, y, p.z + outward.z * off];
  const topA = at(a, face, base + TALUS_HEIGHT_M);
  const topB = at(b, face, base + TALUS_HEIGHT_M);
  const spread = (TALUS_SPREAD_M * (TALUS_HEIGHT_M + TALUS_FOOT_DEPTH_M)) / TALUS_HEIGHT_M;
  const footA = at(a, face + spread, base - TALUS_FOOT_DEPTH_M);
  const footB = at(b, face + spread, base - TALUS_FOOT_DEPTH_M);
  const positions = [...topA, ...footA, ...footB, ...topA, ...footB, ...topB];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  // Outward and upward: flip the winding if the normal points into the wall.
  const n = g.getAttribute('normal');
  if (n.getX(0) * outward.x + n.getZ(0) * outward.z < 0) {
    g.setAttribute('position', new BufferAttribute(new Float32Array([...topA, ...footB, ...footA, ...topA, ...topB, ...footB]), 3));
    g.computeVertexNormals();
  }
  return g;
}

export function buildTowerGeometry(tower: TowerSite): { stone: BufferGeometry; roof: BufferGeometry } {
  const white = new Color('#ffffff');
  const base = tower.baseHeightM;
  const parts: BufferGeometry[] = [];
  const bodyH = tower.heightM + BURY_M;
  const body = new CylinderGeometry(tower.radiusM * 0.96, tower.radiusM * 1.06, bodyH, TOWER_SIDES, 1, false);
  body.translate(tower.center.x, base - BURY_M + bodyH / 2, tower.center.z);
  parts.push(body);
  // Battered base (glacis): the tower flares out where it meets the ground.
  const glacis = new CylinderGeometry(tower.radiusM * 1.06, tower.radiusM * 1.06 + GLACIS_FLARE_M, GLACIS_HEIGHT_M + BURY_M, TOWER_SIDES, 1, true);
  glacis.translate(tower.center.x, base - BURY_M + (GLACIS_HEIGHT_M + BURY_M) / 2, tower.center.z);
  parts.push(glacis);
  // Corbelled crown: a slightly wider ring carrying the merlons.
  const crownH = 0.6;
  const crown = new CylinderGeometry(tower.radiusM + 0.35, tower.radiusM * 0.96, crownH, TOWER_SIDES, 1, false);
  crown.translate(tower.center.x, base + tower.heightM - crownH / 2, tower.center.z);
  parts.push(crown);
  for (let k = 0; k < TOWER_MERLONS; k++) {
    const a = (k / TOWER_MERLONS) * Math.PI * 2;
    const r = tower.radiusM + 0.35 - MERLON_DEPTH_M / 2;
    parts.push(
      boxGeometry({
        center: new Vector3(tower.center.x + Math.cos(a) * r, base + tower.heightM + MERLON_HEIGHT_M / 2, tower.center.z + Math.sin(a) * r),
        size: new Vector3(MERLON_DEPTH_M, MERLON_HEIGHT_M, MERLON_WIDTH_M * 1.1),
        yaw: -a,
      }),
    );
  }
  const around: AlongFn = (x, z) => Math.atan2(z - tower.center.z, x - tower.center.x) * tower.radiusM;
  const stone = mergeGeometries(parts.map((p) => finish(p, base, white, around)), false);
  parts.forEach((p) => p.dispose());
  if (!stone) throw new Error('tower merge failed');

  const roofR = tower.radiusM + ROOF_OVERHANG_M;
  const roofH = roofR * 2 * TOWER_ROOF_RATIO;
  const roofGeo = new ConeGeometry(roofR, roofH, TOWER_SIDES * 2, ROOF_SHINGLE_ROWS, false).toNonIndexed();
  roofGeo.translate(tower.center.x, base + tower.heightM + MERLON_HEIGHT_M + roofH / 2 - 0.2, tower.center.z);
  const roof = finish(roofGeo, base, new Color(ROOF_COLOR));
  // Painted shingle rows: alternating tones per row, a little darker towards the eaves.
  const colors = roof.getAttribute('color');
  const pos = roof.getAttribute('position');
  const roofBase = base + tower.heightM + MERLON_HEIGHT_M - 0.2;
  const shingle = new Color(ROOF_COLOR);
  const c = new Color();
  for (let tri = 0; tri < pos.count / 3; tri++) {
    const y = (pos.getY(tri * 3) + pos.getY(tri * 3 + 1) + pos.getY(tri * 3 + 2)) / 3;
    const row = Math.floor(((y - roofBase) / roofH) * ROOF_SHINGLE_ROWS);
    const tone = (row % 2 === 0 ? 1.0 : 0.88) * (0.82 + 0.18 * ((y - roofBase) / roofH)) * (0.94 + 0.12 * ((tri * 7919) % 13) / 13);
    c.copy(shingle).multiplyScalar(tone);
    for (let k = 0; k < 3; k++) colors.setXYZ(tri * 3 + k, c.r, c.g, c.b);
  }
  // Iron finial at the apex.
  const apexY = roofBase + roofH;
  const finialGeo = new ConeGeometry(0.12, FINIAL_HEIGHT_M, 6, 1, false).toNonIndexed();
  finialGeo.translate(tower.center.x, apexY + FINIAL_HEIGHT_M / 2 - 0.1, tower.center.z);
  const finial = finish(finialGeo, base, new Color(FINIAL_COLOR));
  const roofWithFinial = mergeGeometries([roof, finial], false);
  if (!roofWithFinial) throw new Error('tower roof merge failed');
  return { stone, roof: roofWithFinial };
}
