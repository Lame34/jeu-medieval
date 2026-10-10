/**
 * Camera views and limits of a generated battle map (bench, captures, opening shot). Derived
 * from the layout: whole-map overview, attacker deployment facing the castle, gate approach,
 * village, and a close-up on the first attacker.
 */
import type { Vec2 } from '../../core/math/vec2.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import type { CameraLimits, CameraView } from '../camera/TacticalCamera.tsx';

export type BattleView = CameraView & { readonly id: string; readonly label: string };

/** The opening view frames the main body of the army: the units within this of its densest point. */
const MAIN_BODY_RADIUS_M = 28;
const OPENING_DISTANCE_M = 62;
/** The focus leads the army towards the castle: the men in the lower half, under the briefing, the road ahead above. */
const OPENING_LEAD_M = 10;
const OPENING_PITCH_DEG = 46;
/** The establishing shot: the castle from the army's side, before the glide to the army. */
const INTRO_DISTANCE_M = 115;
const INTRO_PITCH_DEG = 30;

/** Yaw (turns) of a camera looking from `from` towards `to` (camera sits at focus + (sin, cos)). */
function yawLooking(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z)) / (2 * Math.PI);
}

function centroid(points: readonly Vec2[], fallback: Vec2): Vec2 {
  if (points.length === 0) return fallback;
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, z: s.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
}

function keepOf(layout: WorldLayout): Vec2 {
  const center = { x: (layout.playable.minX + layout.playable.maxX) / 2, z: (layout.playable.minZ + layout.playable.maxZ) / 2 };
  return layout.keeps[0]?.center ?? centroid(layout.towers.map((t) => t.center), center);
}

/**
 * The army's main body: the units around the one with the most comrades within
 * MAIN_BODY_RADIUS_M (the first such in order), not the empty middle of scattered groups.
 */
function mainBody(units: readonly Vec2[], fallback: Vec2): Vec2 {
  let best: Vec2[] = [];
  for (const u of units) {
    const near = units.filter((p) => Math.hypot(p.x - u.x, p.z - u.z) <= MAIN_BODY_RADIUS_M);
    if (near.length > best.length) best = near;
  }
  return centroid(best, fallback);
}

/** Opening view of a battle in play: over the army's main body, looking towards the castle. */
export function openingView(layout: WorldLayout, units: readonly Vec2[]): BattleView {
  const body = mainBody(units, layout.focus);
  const keep = keepOf(layout);
  const d = Math.hypot(keep.x - body.x, keep.z - body.z) || 1;
  const focus = { x: body.x + ((keep.x - body.x) / d) * OPENING_LEAD_M, z: body.z + ((keep.z - body.z) / d) * OPENING_LEAD_M };
  return { id: 'opening', label: 'Vos troupes', focus, distance: OPENING_DISTANCE_M, yawTurns: yawLooking(body, keep), pitchDeg: OPENING_PITCH_DEG };
}

/** The establishing shot's first view: the castle, seen from where the army stands. */
export function introView(layout: WorldLayout, units: readonly Vec2[]): BattleView {
  const keep = keepOf(layout);
  const army = units.length > 0 ? centroid(units, layout.focus) : layout.focus;
  return { id: 'intro', label: 'Le château', focus: keep, distance: INTRO_DISTANCE_M, yawTurns: yawLooking(army, keep), pitchDeg: INTRO_PITCH_DEG };
}

export function battleViews(layout: WorldLayout): readonly BattleView[] {
  const p = layout.playable;
  const center = { x: (p.minX + p.maxX) / 2, z: (p.minZ + p.maxZ) / 2 };
  const keep = layout.keeps[0]?.center ?? centroid(layout.towers.map((t) => t.center), center);
  const gate = layout.gates[0]?.center ?? keep;
  const village = centroid(
    layout.houses.map((h) => h.center),
    center,
  );
  const attacker = layout.units.find((u) => u.faction === 'attacker')?.position ?? layout.focus;
  const bridge = layout.bridges[0];
  const bridgeMid = bridge ? { x: (bridge.from.x + bridge.to.x) / 2, z: (bridge.from.z + bridge.to.z) / 2 } : center;
  // The overview frames the whole stake: from the attackers' deployment to the castle.
  const stake = { x: (layout.focus.x + keep.x) / 2, z: (layout.focus.z + keep.z) / 2 };
  return [
    { id: 'overview', label: 'Vue d’ensemble', focus: stake, distance: 230, yawTurns: yawLooking(layout.focus, keep), pitchDeg: 55 },
    { id: 'deployment', label: 'Déploiement', focus: layout.focus, distance: 65, yawTurns: yawLooking(layout.focus, keep), pitchDeg: 48 },
    { id: 'gate', label: 'Porte du château', focus: gate, distance: 55, yawTurns: yawLooking(gate, keep), pitchDeg: 26 },
    { id: 'village', label: 'Village', focus: village, distance: 45, yawTurns: yawLooking(village, keep), pitchDeg: 40 },
    { id: 'bridge', label: 'Pont', focus: bridgeMid, distance: 40, yawTurns: yawLooking(bridgeMid, keep) + 0.2, pitchDeg: 30 },
    { id: 'close', label: 'Plan rapproché', focus: attacker, distance: 12, yawTurns: yawLooking(attacker, keep), pitchDeg: 26 },
  ];
}

export function battleLimits(layout: WorldLayout): CameraLimits {
  return { minDistance: 8, maxDistance: 280, minPitchDeg: 12, maxPitchDeg: 70, bounds: layout.playable };
}
