/**
 * Castle pieces beyond curtain walls and round towers (brief §6.2): the keep (square
 * crenellated tower with a pyramid roof), the gatehouse (crenellated lintel over the opening,
 * studded double door), the timber bridge over the moat in front of the gate, and the stone
 * bridge over the river. Stone parts share the procedural masonry; timber parts are painted
 * with vertex colours. Same attribute layout as castle-geometry.ts (merge-compatible).
 */
import { Color, ConeGeometry, Matrix4, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../../core/math/vec2.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { GATEHOUSE, liftHingeM, liftTipM } from '../../core/worldgen/gatehouse.ts';
import type { BridgeSite, GateSite, KeepSite, StairSite } from '../../core/worldgen/types.ts';
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
const DOOR_PLANKS = 7;
const DOOR_THICKNESS_M = 0.22;
/** Doors stand this far inside the gatehouse face; the portcullis this far inside the centre. */
const DOOR_INSET_M = 0.35;
const PORTCULLIS_INSET_M = 0.6;
const PORTCULLIS_BAR_STEP_M = 0.42;
const PORTCULLIS_RAIL_STEP_M = 0.7;
const PORTCULLIS_BAR_M = 0.09;
const IRON_COLOR = '#45403c';
const TRESTLE_EVERY_M = 3.5;
/** The timber bridge spans the moat: from the berm to beyond the outer bank (m from the gate). */
const MOAT_BRIDGE_TO_M = 17.5;
const PLANK_M = 0.45;
const PLANK_GAP_M = 0.06;
const DECK_THICKNESS_M = 0.22;
/** Share of its pitch a deck plank fills (fixed bridges), and on the lifting span. */
const PLANK_FILL = 0.88;
const LIFT_PLANK_FILL = 0.97;
/** The lifting span's backing board under the planks, and its two iron bands. */
const LIFT_BACKING_M = 0.05;
const LIFT_BACKING_DROP_M = 0.03;
const LIFT_BACKING_COLOR = '#6e5034';
const LIFT_BAND_M = 0.04;
const LIFT_BAND_WIDTH_M = 0.16;
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

/**
 * The gatehouse's fixed parts: the crenellated lintel over the opening and, in front of a
 * drawbridge, the fixed timber bridge from the lifting span's tip to the outer bank. The doors,
 * the portcullis and the lifting span move (buildGatePieces).
 */
export function buildGate(gate: GateSite, terrain: TerrainData): CastleParts {
  const { fwd } = frame(gate.rotationTurns);
  const base = gate.baseHeightM;
  const span = gate.openingM + 2 * GATE_LINTEL_OVERHANG_M;
  // Lintel: a short crenellated wall above the opening, merlons facing out.
  const travel = { x: -fwd.z, z: fwd.x };
  const lintel = buildWallGeometry(
    {
      id: `${gate.id}-lintel`,
      points: [at(gate.center, travel, -span / 2, fwd, 0), at(gate.center, travel, span / 2, fwd, 0)],
      heightM: gate.heightM - GATE_OPENING_HEIGHT_M - BURY_M,
      thicknessM: GATEHOUSE.depthM,
      baseHeightM: base + GATE_OPENING_HEIGHT_M + BURY_M,
    },
    base,
    false,
  );
  const wood = gate.drawbridge ? fixedBridge(gate, terrain) : [];
  return { stone: [lintel], roof: [], wood };
}

/** Moving parts of a gatehouse, in its local frame: origin at the gate centre on the sill, +x across, +z outwards. */
export interface GatePieces {
  /** Door leaves standing in the opening; pivot (their foot) at `doorPivotZ`. */
  readonly doors: BufferGeometry;
  readonly doorPivotZ: number;
  /** Iron grid behind the doors; pivot at `portcullisPivotZ`. */
  readonly portcullis: BufferGeometry;
  readonly portcullisPivotZ: number;
  /** Lifting span, laid along +z from its hinge (at `liftHingeZ` on the sill), deck top at y = 0. */
  readonly lift: BufferGeometry | null;
  readonly liftHingeZ: number;
}

/** Local frame of a gate: `group.position.set(x, sill, z)` and `group.rotation.y` = this yaw. */
export function gateYaw(gate: GateSite): number {
  return gate.rotationTurns * 2 * Math.PI;
}

export function buildGatePieces(gate: GateSite): GatePieces {
  const woodLit = new Color(PALETTE.woodWarm.lit);
  const woodBase = new Color(PALETTE.woodWarm.base);
  const iron = new Color(IRON_COLOR);
  // Doors: planks with two iron straps, standing just inside the gatehouse face.
  const doorZ = GATEHOUSE.depthM / 2 - DOOR_INSET_M;
  const plankW = gate.openingM / DOOR_PLANKS;
  const doorParts: BufferGeometry[] = [];
  for (let k = 0; k < DOOR_PLANKS; k++) {
    const tone = woodBase.clone().lerp(woodLit, 0.25 + 0.3 * ((k * 5) % 3) / 2);
    const x = -gate.openingM / 2 + plankW * (k + 0.5);
    doorParts.push(finish(boxGeometry({ center: new Vector3(x, GATE_OPENING_HEIGHT_M / 2 - 0.3, -DOOR_THICKNESS_M / 2), size: new Vector3(plankW * 0.96, GATE_OPENING_HEIGHT_M + 0.6, DOOR_THICKNESS_M), yaw: 0 }), 0, tone));
  }
  for (const h of [1.1, GATE_OPENING_HEIGHT_M - 1.2]) {
    doorParts.push(finish(boxGeometry({ center: new Vector3(0, h, 0.03), size: new Vector3(gate.openingM, 0.16, 0.06), yaw: 0 }), 0, iron));
  }
  // Portcullis: an iron grid with spiked feet, further in.
  const grille: BufferGeometry[] = [];
  const width = gate.openingM - 0.1;
  const bars = Math.floor(width / PORTCULLIS_BAR_STEP_M);
  for (let k = 0; k <= bars; k++) {
    const x = -width / 2 + (k * width) / bars;
    grille.push(finish(boxGeometry({ center: new Vector3(x, GATE_OPENING_HEIGHT_M / 2 + 0.2, 0), size: new Vector3(PORTCULLIS_BAR_M, GATE_OPENING_HEIGHT_M + 0.4, PORTCULLIS_BAR_M), yaw: 0 }), 0, iron));
  }
  for (let y = PORTCULLIS_RAIL_STEP_M; y < GATE_OPENING_HEIGHT_M; y += PORTCULLIS_RAIL_STEP_M) {
    grille.push(finish(boxGeometry({ center: new Vector3(0, y, 0), size: new Vector3(width, PORTCULLIS_BAR_M * 0.8, PORTCULLIS_BAR_M * 1.3), yaw: 0 }), 0, iron));
  }
  const lift = gate.drawbridge ? liftSpan(gate) : null;
  const doors = mergeOrThrow(doorParts, 'doors');
  const portcullis = mergeOrThrow(grille, 'portcullis');
  return { doors, doorPivotZ: doorZ, portcullis, portcullisPivotZ: -PORTCULLIS_INSET_M, lift, liftHingeZ: liftHingeM() };
}

function mergeOrThrow(parts: BufferGeometry[], name: string): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error(`gate ${name}: merge failed`);
  return merged;
}

/**
 * Timber deck (planks across, two stringers under), from z = 0 to `length`, top at y = 0; each
 * plank fills `fill` of its pitch (the rest is the gap between planks).
 */
function timberDeck(width: number, length: number, paintBase: number, fill = PLANK_FILL): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const lit = new Color(PALETTE.woodLight.lit);
  const dark = new Color(PALETTE.woodLight.base);
  const count = Math.max(1, Math.floor(length / (PLANK_M + PLANK_GAP_M)));
  for (let k = 0; k < count; k++) {
    const tone = dark.clone().lerp(lit, 0.35 + 0.45 * (((k * 37) % 11) / 10));
    out.push(finish(boxGeometry({ center: new Vector3(0, -DECK_THICKNESS_M / 2, ((k + 0.5) / count) * length), size: new Vector3(width, DECK_THICKNESS_M, (length / count) * fill), yaw: 0 }), paintBase, tone));
  }
  const stringer = dark.clone().multiplyScalar(0.8);
  for (const side of [-1, 1]) {
    out.push(finish(boxGeometry({ center: new Vector3(side * (width / 2 - 0.15), -DECK_THICKNESS_M - 0.2, length / 2), size: new Vector3(0.3, 0.4, length), yaw: 0 }), paintBase, stringer));
  }
  return out;
}

/** The lifting span, in its hinge frame (see GatePieces.lift). */
function liftSpan(gate: GateSite): BufferGeometry {
  // Planks nearly joined: raised, the gaps showed their lit edges as the bars of a portcullis.
  const parts = timberDeck(gate.openingM + 0.6, GATEHOUSE.liftSpanM, 0, LIFT_PLANK_FILL);
  // Iron-shod edge at the tip, rings for the chains.
  const iron = new Color(IRON_COLOR);
  parts.push(finish(boxGeometry({ center: new Vector3(0, -DECK_THICKNESS_M / 2, GATEHOUSE.liftSpanM - 0.08), size: new Vector3(gate.openingM + 0.7, DECK_THICKNESS_M + 0.06, 0.16), yaw: 0 }), 0, iron));
  // Raised, the span shows its underside to the attackers: a solid backing (no light through the
  // plank gaps, which read as a portcullis) bound by two iron bands.
  const backY = -DECK_THICKNESS_M - LIFT_BACKING_DROP_M;
  parts.push(finish(boxGeometry({ center: new Vector3(0, backY, GATEHOUSE.liftSpanM / 2), size: new Vector3(gate.openingM + 0.6, LIFT_BACKING_M, GATEHOUSE.liftSpanM), yaw: 0 }), 0, new Color(LIFT_BACKING_COLOR)));
  for (const at of [0.25, 0.75]) {
    parts.push(finish(boxGeometry({ center: new Vector3(0, backY - LIFT_BACKING_M / 2 - LIFT_BAND_M / 2, GATEHOUSE.liftSpanM * at), size: new Vector3(gate.openingM + 0.7, LIFT_BAND_M, LIFT_BAND_WIDTH_M), yaw: 0 }), 0, iron));
  }
  return mergeOrThrow(parts, 'lift');
}

/** Fixed bridge from the lifting span's tip to the outer bank (world space), on trestles in the moat. */
function fixedBridge(gate: GateSite, terrain: TerrainData): BufferGeometry[] {
  const { fwd, right } = frame(gate.rotationTurns);
  const from = liftTipM();
  const to = gate.crossingEndM ?? MOAT_BRIDGE_TO_M;
  if (to <= from) return [];
  const width = gate.openingM + 0.6;
  const yaw = gateYaw(gate);
  const place = (g: BufferGeometry, along: number) => {
    g.applyMatrix4(new Matrix4().makeRotationY(yaw).setPosition(gate.center.x + fwd.x * along, gate.baseHeightM, gate.center.z + fwd.z * along));
    return g;
  };
  const out = timberDeck(width, to - from, 0).map((g) => place(g, from));
  // Trestle posts down to the moat bed at the span's tip and every few metres.
  const post = new Color(PALETTE.woodWarm.base);
  for (let along = from + 0.2; along < to - 0.5; along += TRESTLE_EVERY_M) {
    for (const side of [-1, 1]) {
      const c = at(gate.center, fwd, along, right, side * (width / 2 - 0.2));
      const ground = sampleHeight(terrain, c.x, c.z);
      const h = gate.baseHeightM - ground + 0.6;
      if (h < 0.6) continue;
      out.push(finish(boxGeometry({ center: new Vector3(c.x, ground - 0.6 + h / 2 - DECK_THICKNESS_M, c.z), size: new Vector3(0.32, h, 0.32), yaw }), gate.baseHeightM, post));
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

/** Stairs up to the wall-walk (J4): stone steps from the courtyard to the wall-walk height. */
const STAIR_TREAD_M = 0.5;

export function buildStairs(stair: StairSite): CastleParts {
  const dx = stair.top.x - stair.bottom.x;
  const dz = stair.top.z - stair.bottom.z;
  const length = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / length, z: dz / length };
  const yaw = Math.atan2(-dir.z, dir.x);
  const steps = Math.max(1, Math.round(length / STAIR_TREAD_M));
  const tread = length / steps;
  const base = stair.bottomHeightM - BURY_M;
  const stone: BufferGeometry[] = [];
  // Masonry courses run along the flight.
  const along: AlongFn = (x, z) => (x - stair.bottom.x) * dir.x + (z - stair.bottom.z) * dir.z;
  for (let k = 0; k < steps; k++) {
    const topY = stair.bottomHeightM + ((stair.topHeightM - stair.bottomHeightM) * (k + 1)) / steps;
    const s = (k + 0.5) * tread;
    const center = new Vector3(stair.bottom.x + dir.x * s, (base + topY) / 2, stair.bottom.z + dir.z * s);
    stone.push(finish(boxGeometry({ center, size: new Vector3(tread, topY - base, stair.widthM), yaw }), stair.bottomHeightM, WHITE, along));
  }
  return { stone, roof: [], wood: [] };
}
