/**
 * Movement planning shared by the UI preview and command execution: the path the player sees
 * is exactly the path the core executes.
 */
import type { CommandRejection } from '../commands/types.ts';
import type { Vec2 } from '../math/vec2.ts';
import { AP_EPSILON, findPath, smoothPath, type BlockedPredicate } from '../nav-grid/pathfinding.ts';
import { computeReachable, type ReachableField } from '../nav-grid/reachable.ts';
import type { MovementProfile, UnitTypeRule } from '../rules/types.ts';
import type { BattleContext } from './context.ts';
import { cellIndexOf, snapToCellCenter } from './create.ts';
import { syncNav } from './structures.ts';
import type { BattleState, UnitState } from './types.ts';

export interface MovePlan {
  readonly unitId: string;
  readonly destination: Vec2;
  readonly path: readonly Vec2[];
  readonly apCost: number;
  readonly apSpent: number;
}

export type MovePlanResult = { readonly ok: true; readonly plan: MovePlan } | { readonly ok: false; readonly reason: CommandRejection };

export interface MovementArea {
  readonly field: ReachableField;
  /** Cells with cost ≤ this can still act after moving (inner contour). */
  readonly moveAndActBudget: number;
  /** Cells with cost ≤ this are reachable at all (outer contour). */
  readonly moveOnlyBudget: number;
}

/** Whole AP deducted for a fractional path cost. */
export function apSpentFor(cost: number): number {
  return Math.max(0, Math.ceil(cost - AP_EPSILON));
}

export function findUnit(state: BattleState, unitId: string): UnitState | undefined {
  return state.units.find((u) => u.id === unitId);
}

export function unitType(ctx: BattleContext, unit: UnitState): UnitTypeRule {
  const type = ctx.rules.units[unit.typeKey];
  if (!type) throw new RangeError(`unknown unit type "${unit.typeKey}"`);
  return type;
}

/** Cells holding a living unit, keyed by cell index. */
export function occupancy(ctx: BattleContext, state: BattleState): Map<number, UnitState> {
  const map = new Map<number, UnitState>();
  for (const u of state.units) if (u.alive) map.set(cellIndexOf(ctx, u.position), u);
  return map;
}

/** Enemies block movement; allies can be walked through but not stopped on. */
function enemyBlocker(occupied: Map<number, UnitState>, mover: UnitState): BlockedPredicate {
  return (index) => {
    const other = occupied.get(index);
    return other !== undefined && other.faction !== mover.faction;
  };
}

export function planMove(ctx: BattleContext, state: BattleState, unitId: string, target: Vec2): MovePlanResult {
  syncNav(ctx, state.structures);
  const unit = findUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'unknownUnit' };
  if (!unit.alive) return { ok: false, reason: 'unitDead' };
  const nav = ctx.nav;
  if (target.x < 0 || target.z < 0 || target.x >= nav.width * nav.cellSize || target.z >= nav.depth * nav.cellSize) {
    return { ok: false, reason: 'outOfBounds' };
  }
  const destination = snapToCellCenter(ctx, target);
  const start = cellIndexOf(ctx, unit.position);
  const goal = cellIndexOf(ctx, destination);
  if (start === goal) return { ok: false, reason: 'sameCell' };
  const occupied = occupancy(ctx, state);
  if (occupied.has(goal)) return { ok: false, reason: 'destinationOccupied' };

  const profile: MovementProfile = unitType(ctx, unit).movement;
  const blocked = enemyBlocker(occupied, unit);
  const grid = findPath(ctx.paths, { profile, start, goal, blocked, maxCost: unit.ap });
  if (!grid) {
    const unbounded = findPath(ctx.paths, { profile, start, goal, blocked });
    return { ok: false, reason: unbounded ? 'insufficientAp' : 'noPath' };
  }
  const smooth = smoothPath(nav, profile, grid.cells, blocked);
  const apSpent = apSpentFor(smooth.cost);
  if (apSpent > unit.ap) return { ok: false, reason: 'insufficientAp' };
  return { ok: true, plan: { unitId, destination, path: smooth.waypoints, apCost: smooth.cost, apSpent } };
}

export function movementArea(ctx: BattleContext, state: BattleState, unitId: string): MovementArea | null {
  syncNav(ctx, state.structures);
  const unit = findUnit(state, unitId);
  if (!unit || !unit.alive) return null;
  const type = unitType(ctx, unit);
  const occupied = occupancy(ctx, state);
  const field = computeReachable(ctx.paths, {
    profile: type.movement,
    origin: cellIndexOf(ctx, unit.position),
    budget: unit.ap,
    blocked: enemyBlocker(occupied, unit),
  });
  return {
    field,
    moveAndActBudget: Math.max(0, unit.ap - ctx.rules.movement.actionReserveAp),
    moveOnlyBudget: unit.ap,
  };
}
