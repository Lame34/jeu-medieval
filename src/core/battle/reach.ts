/**
 * Doing what the player asked from where it can be done (J7, ADR-039). A blow on an enemy, on a
 * gate or a wall, a turn of works, a climb up a docked beffroi, docking it: each needs the man
 * within some reach. When he is not, the shortest walk this turn that brings him there, keeping
 * the points of action the deed needs, is found here. The battle then receives two plain orders,
 * the walk and the deed, so a replay is exact. A walk ordered beyond this turn's reach is cut
 * where the points of action run out, on the way to the point asked.
 */
import type { CommandRejection } from '../commands/types.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import { IMPASSABLE } from '../nav-grid/nav-grid.ts';
import { findPath } from '../nav-grid/pathfinding.ts';
import { cellCenter } from '../terrain-data/terrain-data.ts';
import { previewAttack, type AttackPreview } from './combat.ts';
import type { BattleContext } from './context.ts';
import { cellIndexOf } from './create.ts';
import { fillCells, fillSiteAt } from './moat.ts';
import { enemyBlocker, findUnit, movementArea, occupancy, planMove, unitType, type MovePlan, type MovePlanResult } from './movement.ts';
import { distanceToCells, distanceToStructure, previewStructureAttack, type StructureAttackPreview } from './siege.ts';
import { CLIMB_REACH_M, previewClimb, previewDock, type ClimbPreview, type DockPreview } from './siege-tower.ts';
import { previewFill, previewUndermine, type WorkPreview } from './siege-works.ts';
import { structureDef } from './structures.ts';
import type { BattleState, UnitState } from './types.ts';

/** What every preview of the rules returns. */
export type Preview<T> = { readonly ok: true; readonly preview: T } | { readonly ok: false; readonly reason: CommandRejection };

export interface Approach<T> {
  /** The walk first, or null when the deed can be done from where he stands. */
  readonly move: MovePlan | null;
  /** The deed as it would be done from where the walk ends. */
  readonly preview: T;
}

/** Only distance and sight are cured by walking (not a spent turn, a raised drawbridge…). */
const CURED_BY_WALKING: ReadonlySet<CommandRejection> = new Set(['outOfRange', 'noLineOfSight']);
/** Spots tried at most (nearest first): enough for any reach, bounded for a pointer's hover. */
const MAX_SPOTS = 400;
/**
 * A shot can carry farther than its range from a height (rules.damage.rangePerHeightStep): spots
 * are first sifted by this share of the range, then the rules decide.
 */
const RANGE_SIFT = 1.6;

/**
 * The deed `act` (a preview of the rules, on a state) done from where the man stands, or after the
 * shortest walk this turn to a free spot within `reach` of the deed's object (`distanceTo`), or
 * null when no walk this turn makes it possible.
 */
export function planApproach<T>(ctx: BattleContext, state: BattleState, unitId: string, act: (s: BattleState) => Preview<T>, distanceTo: (p: Vec2) => number, reach: number): Approach<T> | null {
  const here = act(state);
  if (here.ok) return { move: null, preview: here.preview };
  if (!CURED_BY_WALKING.has(here.reason)) return null;
  const unit = findUnit(state, unitId);
  const area = movementArea(ctx, state, unitId);
  if (!unit || !area) return null;
  const occupied = occupancy(ctx, state);
  const { field } = area;
  const spots: { readonly x: number; readonly z: number; readonly cost: number; readonly index: number }[] = [];
  for (let wz = 0; wz < field.depth; wz++) {
    for (let wx = 0; wx < field.width; wx++) {
      const cost = field.cost[wz * field.width + wx] as number;
      if (cost === IMPASSABLE || cost <= 0 || cost > unit.ap) continue;
      const cx = field.minCx + wx;
      const cz = field.minCz + wz;
      const index = cz * ctx.nav.width + cx;
      if (occupied.has(index)) continue;
      const p = cellCenter(ctx.terrain, cx, cz);
      if (distanceTo(p) > reach) continue;
      spots.push({ x: p.x, z: p.z, cost, index });
    }
  }
  spots.sort((a, b) => a.cost - b.cost || a.index - b.index);
  for (const spot of spots.slice(0, MAX_SPOTS)) {
    const walk = planMove(ctx, state, unitId, spot);
    if (!walk.ok) continue;
    const moved: BattleState = { ...state, units: state.units.map((u) => (u.id === unitId ? { ...u, position: walk.plan.destination, ap: u.ap - walk.plan.apSpent } : u)) };
    const done = act(moved);
    if (done.ok) return { move: walk.plan, preview: done.preview };
  }
  return null;
}

/** How near a man must come to strike, or to shoot (the range, sifted generously): spots farther are not tried. */
export function weaponReach(ctx: BattleContext, unit: UnitState): number {
  return Math.max(ctx.rules.damage.meleeReachM, (unitType(ctx, unit).attack?.rangeM ?? 0) * RANGE_SIFT);
}

/** A blow (or a shot) on an enemy: struck at once, after a walk this turn, or not this turn. */
export function planStrike(ctx: BattleContext, state: BattleState, attackerId: string, targetId: string): Approach<AttackPreview> | null {
  const attacker = findUnit(state, attackerId);
  const target = findUnit(state, targetId);
  if (!attacker || !target || !unitType(ctx, attacker).attack) return null;
  return planApproach(ctx, state, attackerId, (s) => previewAttack(ctx, s, attackerId, targetId), (p) => distance(p, target.position), weaponReach(ctx, attacker));
}

/** An engine's blow on a gate, a portcullis or a wall. */
export function planStructureStrike(ctx: BattleContext, state: BattleState, unitId: string, structureId: string): Approach<StructureAttackPreview> | null {
  const unit = findUnit(state, unitId);
  const def = structureDef(ctx, structureId);
  if (!unit || !def || !unitType(ctx, unit).attack) return null;
  return planApproach(ctx, state, unitId, (s) => previewStructureAttack(ctx, s, unitId, structureId), (p) => distanceToStructure(ctx, def, p), weaponReach(ctx, unit));
}

/** A turn of fascines thrown into the moat at `at`. */
export function planFill(ctx: BattleContext, state: BattleState, unitId: string, at: Vec2): Approach<WorkPreview> | null {
  const site = fillSiteAt(ctx, at);
  if (!site) return null;
  const cells = fillCells(ctx, site);
  return planApproach(ctx, state, unitId, (s) => previewFill(ctx, s, unitId, at), (p) => distanceToCells(ctx, cells, p), ctx.rules.damage.meleeReachM);
}

/** A turn of mining at the foot of a wall. */
export function planUndermine(ctx: BattleContext, state: BattleState, unitId: string, structureId: string): Approach<WorkPreview> | null {
  const def = structureDef(ctx, structureId);
  if (!def) return null;
  return planApproach(ctx, state, unitId, (s) => previewUndermine(ctx, s, unitId, structureId), (p) => distanceToStructure(ctx, def, p), ctx.rules.damage.meleeReachM);
}

/** A climb up a docked beffroi onto the wall-walk. */
export function planClimb(ctx: BattleContext, state: BattleState, unitId: string, towerId: string): Approach<ClimbPreview> | null {
  const tower = findUnit(state, towerId);
  if (!tower) return null;
  return planApproach(ctx, state, unitId, (s) => previewClimb(ctx, s, unitId, towerId), (p) => distance(p, tower.position), CLIMB_REACH_M);
}

/** A beffroi pushed against a wall and docked there. */
export function planDock(ctx: BattleContext, state: BattleState, towerId: string, structureId: string): Approach<DockPreview> | null {
  const def = structureDef(ctx, structureId);
  if (!def) return null;
  return planApproach(ctx, state, towerId, (s) => previewDock(ctx, s, towerId, structureId), (p) => distanceToStructure(ctx, def, p), ctx.rules.structures.towerDockReachM);
}

/** A walk, cut where this turn's points of action run out when the point asked is farther. */
export type AdvanceResult = { readonly ok: true; readonly plan: MovePlan; readonly partial: boolean } | { readonly ok: false; readonly reason: CommandRejection };

/**
 * The walk to `target`, or, beyond this turn's reach, as far as the points of action carry him on
 * the way there (the farthest free cell of the path he can reach). A place no path leads to stays
 * refused.
 */
export function planAdvance(ctx: BattleContext, state: BattleState, unitId: string, target: Vec2): AdvanceResult {
  const full: MovePlanResult = planMove(ctx, state, unitId, target);
  if (full.ok) return { ok: true, plan: full.plan, partial: false };
  if (full.reason !== 'insufficientAp') return full;
  const unit = findUnit(state, unitId);
  if (!unit) return full;
  const way = findPath(ctx.paths, { profile: unitType(ctx, unit).movement, start: cellIndexOf(ctx, unit.position), goal: cellIndexOf(ctx, target), blocked: enemyBlocker(occupancy(ctx, state), unit) });
  if (!way) return full;
  // The farthest cell of the way he reaches this turn: cost grows along it, so a bisection finds
  // the last reachable cell; an occupied one is passed for the cell before it.
  const reachable = (i: number) => planMove(ctx, state, unitId, cellCenter(ctx.terrain, (way.cells[i] as number) % ctx.nav.width, Math.floor((way.cells[i] as number) / ctx.nav.width)));
  let lo = 0;
  let hi = way.cells.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const r = reachable(mid);
    if (r.ok || r.reason === 'destinationOccupied') lo = mid;
    else hi = mid;
  }
  for (let i = lo; i > 0; i--) {
    const r = reachable(i);
    if (r.ok) return { ok: true, plan: r.plan, partial: true };
  }
  return full;
}
