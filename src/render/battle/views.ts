/**
 * Camera views and limits of a generated battle map (bench, captures, opening shot). Derived
 * from the layout: whole-map overview, attacker deployment facing the castle, gate approach,
 * village, and a close-up on the first attacker.
 */
import type { Vec2 } from '../../core/math/vec2.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import type { CameraLimits, CameraView } from '../camera/TacticalCamera.tsx';

export type BattleView = CameraView & { readonly id: string; readonly label: string };

/** Yaw (turns) of a camera looking from `from` towards `to` (camera sits at focus + (sin, cos)). */
function yawLooking(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z)) / (2 * Math.PI);
}

function centroid(points: readonly Vec2[], fallback: Vec2): Vec2 {
  if (points.length === 0) return fallback;
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, z: s.z + p.z }), { x: 0, z: 0 });
  return { x: sum.x / points.length, z: sum.z / points.length };
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
