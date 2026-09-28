/**
 * Castle pieces beyond curtain walls and round towers (brief §6.2): the keep (square
 * crenellated tower with a pyramid roof), the gatehouse (crenellated lintel over the opening,
 * studded double door), the timber bridge over the moat in front of the gate, and the stone
 * bridge over the river. Stone parts share the procedural masonry; timber parts are painted
 * with vertex colours. Same attribute layout as castle-geometry.ts (merge-compatible).
 */
import { Color, ConeGeometry, Vector3, type BufferGeometry } from 'three';
import type { Vec2 } from '../../core/math/vec2.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { BridgeSite, GateSite, KeepSite } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';
import { boxGeometry, buildWallGeometry, BURY_M, finish, ROOF_COLOR, ROOF_SHINGLE_ROWS, type AlongFn } from './castle-geometry.ts';

export interface CastleParts {
  readonly stone: BufferGeometry[];
  readonly roof: BufferGeometry[];
  readonly wood: BufferGeometry[];
}

const WHITE = new Color('#ffffff');
const KEEP_WALL_THICKNESS_M = 2.4;
const KEEP_ROOF_RATIO = 0.55;
const GATE_OPENING_HEIGHT_M = 5;
const GATE_LINTEL_OVERHANG_M = 1.4;
const GATE_WALL_THICKNESS_M = 3;
const DOOR_PLANKS = 7;
const DOOR_THICKNESS_M = 0.22;
/** The timber bridge spans the moat: from the berm to beyond the outer bank (m from the gate). */
const MOAT_BRIDGE_FROM_M = 5;
const MOAT_BRIDGE_TO_M = 17.5;
const PLANK_M = 0.45;
const PLANK_GAP_M = 0.06;
const DECK_THICKNESS_M = 0.22;
const STONE_BRIDGE_SEGMENTS = 14;
const STONE_DECK_THICKNESS_M = 1.1;
const STONE_PARAPET_HEIGHT_M = 0.85;
const STONE_PARAPET_WIDTH_M = 0.45;
const PIER_WIDTH_M = 1.6;

/** Unit vectors of a site facing `rotationTurns` (castle.ts turnsFacing: forward = (sin, cos)). */
function frame(rotationTurns: number): { fwd: Vec2; right: Vec2 } {
  const a = rotationTurns * 2 * Math.PI;
  return { fwd: { x: Math.sin(a), z: Math.cos(a) }, right: { x: Math.cos(a), z: -Math.sin(a) } };
}

const at = (c: Vec2, u: Vec2, su: number, v: Vec2, sv: number): Vec2 => ({ x: c.x + u.x * su + v.x * sv, z: c.z + u.z * su + v.z * sv });
/** Box yaw for a long axis along `d` (castle-geometry convention). */
const yawOf = (d: Vec2) => Math.atan2(-d.z, d.x);
const alongDir =
  (origin: Vec2, d: Vec2): AlongFn =>
  (x, z) =>
    (x - origin.x) * d.x + (z - origin.z) * d.z;

/** Pyramid or cone roof painted in shingle rows (same treatment as the tower roofs). */
function shingledRoof(geometry: BufferGeometry, paintBase: number, roofBaseY: number, roofH: number): BufferGeometry {
  const roof = finish(geometry, paintBase, new Color(ROOF_COLOR));
  const colors = roof.getAttribute('color');
  const pos = roof.getAttribute('position');
  const shingle = new Color(ROOF_COLOR);
  const c = new Color();
  for (let tri = 0; tri < pos.count / 3; tri++) {
    const y = (pos.getY(tri * 3) + pos.getY(tri * 3 + 1) + pos.getY(tri * 3 + 2)) / 3;
    const t = (y - roofBaseY) / roofH;
    const row = Math.floor(t * ROOF_SHINGLE_ROWS);
    const tone = (row % 2 === 0 ? 1.0 : 0.88) * (0.82 + 0.18 * t) * (0.94 + (0.12 * ((tri * 7919) % 13)) / 13);
    c.copy(shingle).multiplyScalar(tone);
    for (let k = 0; k < 3; k++) colors.setXYZ(tri * 3 + k, c.r, c.g, c.b);
  }
  return roof;
}

export function buildKeep(keep: KeepSite): CastleParts {
  const { fwd, right } = frame(keep.rotationTurns);
  const hw = keep.widthM / 2 - KEEP_WALL_THICKNESS_M / 2;
  const hd = keep.depthM / 2 - KEEP_WALL_THICKNESS_M / 2;
  // Corner loop wound so that the merlons (right-hand side of travel) face outwards.
  const corners = [at(keep.center, right, -hw, fwd, -hd), at(keep.center, right, -hw, fwd, hd), at(keep.center, right, hw, fwd, hd), at(keep.center, right, hw, fwd, -hd)];
  const a = corners[0] as Vec2;
  const b = corners[1] as Vec2;
  const d = { x: b.x - a.x, z: b.z - a.z };
  const mid = { x: (a.x + b.x) / 2 - keep.center.x, z: (a.z + b.z) / 2 - keep.center.z };
  if (d.z * mid.x - d.x * mid.z < 0) corners.reverse();
  const loop = [...corners, corners[0] as Vec2];
  const stone = [buildWallGeometry({ id: `${keep.id}-walls`, points: loop, heightM: keep.heightM, thicknessM: KEEP_WALL_THICKNESS_M, baseHeightM: keep.baseHeightM }, keep.baseHeightM, false)];
  // Roof platform inside the parapet.
  const top = keep.baseHeightM + keep.heightM;
  stone.push(finish(boxGeometry({ center: new Vector3(keep.center.x, top - 0.4, keep.center.z), size: new Vector3(hw * 2, 0.8, hd * 2), yaw: yawOf(right) }), keep.baseHeightM, WHITE));
  // Pyramid roof over the platform (four-sided cone turned onto the keep's axes).
  const roofR = Math.hypot(hw, hd) * 0.92;
  const roofH = roofR * 2 * KEEP_ROOF_RATIO;
  const cone = new ConeGeometry(roofR, roofH, 4, 6, false).toNonIndexed();
  cone.rotateY(Math.PI / 4 + yawOf(right));
  cone.translate(keep.center.x, top + roofH / 2 - 0.1, keep.center.z);
  return { stone, roof: [shingledRoof(cone, keep.baseHeightM, top, roofH)], wood: [] };
}

export function buildGate(gate: GateSite, terrain: TerrainData): CastleParts {
  const { fwd, right } = frame(gate.rotationTurns);
  const base = gate.baseHeightM;
  const span = gate.openingM + 2 * GATE_LINTEL_OVERHANG_M;
  // Lintel: a short crenellated wall above the opening, merlons facing out.
  const travel = { x: -fwd.z, z: fwd.x };
  const lintel = buildWallGeometry(
    {
      id: `${gate.id}-lintel`,
      points: [at(gate.center, travel, -span / 2, fwd, 0), at(gate.center, travel, span / 2, fwd, 0)],
      heightM: gate.heightM - GATE_OPENING_HEIGHT_M - BURY_M,
      thicknessM: GATE_WALL_THICKNESS_M,
      baseHeightM: base + GATE_OPENING_HEIGHT_M + BURY_M,
    },
    base,
    false,
  );

  const wood: BufferGeometry[] = [];
  const woodLit = new Color(PALETTE.woodWarm.lit);
  const woodBase = new Color(PALETTE.woodWarm.base);
  const iron = new Color('#3e3f44');
  const doorYaw = yawOf(right);
  const doorCenter = at(gate.center, fwd, 0.2, right, 0);
  const plankW = gate.openingM / DOOR_PLANKS;
  for (let k = 0; k < DOOR_PLANKS; k++) {
    const c = at(doorCenter, right, -gate.openingM / 2 + plankW * (k + 0.5), fwd, 0);
    const tone = woodBase.clone().lerp(woodLit, 0.25 + 0.3 * ((k * 5) % 3) / 2);
    wood.push(finish(boxGeometry({ center: new Vector3(c.x, base + GATE_OPENING_HEIGHT_M / 2 - 0.3, c.z), size: new Vector3(plankW * 0.96, GATE_OPENING_HEIGHT_M + 0.6, DOOR_THICKNESS_M), yaw: doorYaw }), base, tone));
  }
  for (const h of [1.1, GATE_OPENING_HEIGHT_M - 1.2]) {
    const c = at(doorCenter, fwd, DOOR_THICKNESS_M / 2 + 0.03, right, 0);
    wood.push(finish(boxGeometry({ center: new Vector3(c.x, base + h, c.z), size: new Vector3(gate.openingM, 0.16, 0.06), yaw: doorYaw }), base, iron));
  }

  if (gate.drawbridge) wood.push(...timberBridge(gate, fwd, right, terrain));
  return { stone: [lintel], roof: [], wood };
}

/** Plank deck on two stringers from the berm to beyond the outer bank of the moat. */
function timberBridge(gate: GateSite, fwd: Vec2, right: Vec2, terrain: TerrainData): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const width = gate.openingM + 0.6;
  const start = at(gate.center, fwd, MOAT_BRIDGE_FROM_M, right, 0);
  const end = at(gate.center, fwd, MOAT_BRIDGE_TO_M, right, 0);
  const y0 = Math.max(sampleHeight(terrain, start.x, start.z), gate.baseHeightM - 0.6) + 0.2;
  const y1 = sampleHeight(terrain, end.x, end.z) + 0.2;
  const length = MOAT_BRIDGE_TO_M - MOAT_BRIDGE_FROM_M;
  const pitch = Math.atan2(y1 - y0, length);
  const plankYaw = yawOf(right);
  const lit = new Color(PALETTE.woodLight.lit);
  const dark = new Color(PALETTE.woodLight.base);
  const count = Math.floor(length / (PLANK_M + PLANK_GAP_M));
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count;
    const c = at(start, fwd, t * length, right, 0);
    const tone = dark.clone().lerp(lit, 0.35 + 0.45 * (((k * 37) % 11) / 10));
    out.push(finish(boxGeometry({ center: new Vector3(c.x, y0 + (y1 - y0) * t, c.z), size: new Vector3(width, DECK_THICKNESS_M, PLANK_M), yaw: plankYaw }), gate.baseHeightM, tone));
  }
  // Stringers and hand posts (the slope is small: the boxes are laid in steps of the deck).
  const stringerTone = dark.clone().multiplyScalar(0.8);
  const steps = 4;
  for (const side of [-1, 1]) {
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const c = at(start, fwd, t * length, right, side * (width / 2 - 0.15));
      out.push(finish(boxGeometry({ center: new Vector3(c.x, y0 + (y1 - y0) * t - 0.25, c.z), size: new Vector3(0.3, 0.4, length / steps + 0.1 / Math.cos(pitch)), yaw: plankYaw }), gate.baseHeightM, stringerTone));
    }
    for (const t of [0, 1]) {
      const c = at(start, fwd, t * length, right, side * (width / 2 + 0.1));
      out.push(finish(boxGeometry({ center: new Vector3(c.x, (t === 0 ? y0 : y1) + 0.6, c.z), size: new Vector3(0.3, 1.6, 0.3), yaw: plankYaw }), gate.baseHeightM, stringerTone));
    }
  }
  return out;
}

/** Stone road bridge over the river: humped deck, parapets and two piers. */
export function buildStoneBridge(bridge: BridgeSite, terrain: TerrainData, waterLevelM: number): CastleParts {
  const length = Math.hypot(bridge.to.x - bridge.from.x, bridge.to.z - bridge.from.z);
  const d = { x: (bridge.to.x - bridge.from.x) / length, z: (bridge.to.z - bridge.from.z) / length };
  const side = { x: -d.z, z: d.x };
  const yaw = yawOf(d);
  const along = alongDir(bridge.from, d);
  const hFrom = sampleHeight(terrain, bridge.from.x, bridge.from.z);
  const hTo = sampleHeight(terrain, bridge.to.x, bridge.to.z);
  const deckAt = (t: number) => Math.max(hFrom + (hTo - hFrom) * t, hFrom + (hTo - hFrom) * t + (bridge.deckHeightM - Math.min(hFrom, hTo)) * Math.sin(Math.PI * t));
  const paintBase = waterLevelM - 1;
  const stone: BufferGeometry[] = [];
  const segment = length / STONE_BRIDGE_SEGMENTS;
  for (let k = 0; k < STONE_BRIDGE_SEGMENTS; k++) {
    const t = (k + 0.5) / STONE_BRIDGE_SEGMENTS;
    const c = at(bridge.from, d, t * length, side, 0);
    const top = deckAt(t);
    stone.push(finish(boxGeometry({ center: new Vector3(c.x, top - STONE_DECK_THICKNESS_M / 2, c.z), size: new Vector3(segment + 0.05, STONE_DECK_THICKNESS_M, bridge.widthM), yaw }), paintBase, WHITE, along));
    for (const s of [-1, 1]) {
      const p = at(c, side, s * (bridge.widthM / 2 - STONE_PARAPET_WIDTH_M / 2), d, 0);
      stone.push(finish(boxGeometry({ center: new Vector3(p.x, top + STONE_PARAPET_HEIGHT_M / 2, p.z), size: new Vector3(segment + 0.05, STONE_PARAPET_HEIGHT_M, STONE_PARAPET_WIDTH_M), yaw }), paintBase, WHITE, along));
    }
  }
  for (const t of [0.36, 0.64]) {
    const c = at(bridge.from, d, t * length, side, 0);
    const top = deckAt(t) - STONE_DECK_THICKNESS_M;
    const bottom = waterLevelM - 2.5;
    stone.push(finish(boxGeometry({ center: new Vector3(c.x, (top + bottom) / 2, c.z), size: new Vector3(PIER_WIDTH_M, top - bottom, bridge.widthM + 0.4), yaw }), paintBase, WHITE, along));
  }
  return { stone, roof: [], wood: [] };
}
