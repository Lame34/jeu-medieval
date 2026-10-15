/**
 * Orders for several men at once (ADR-044): a walk in rank to a point, or a blow on one enemy by
 * all who can reach him this turn. Each man is planned in turn on a battle where the men before
 * him already stand where they go; each man's orders are plain commands (a replay is exact).
 */
import type { Command } from '../commands/types.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import type { BattleContext } from './context.ts';
import { findUnit, unitType, type MovePlan } from './movement.ts';
import { planAdvance, planStrike } from './reach.ts';
import type { BattleState } from './types.ts';

export interface GroupPlan {
  /** Each man's orders, in the order they are given (none for a man who can do nothing). */
  readonly orders: readonly (readonly Command[])[];
  /** The walks, for the paths drawn on the ground. */
  readonly walks: readonly MovePlan[];
  /** Men who strike this turn, who close in on the enemy, who reach their place, who stop on the way, who can do nothing. */
  readonly strikes: number;
  readonly closeIn: number;
  readonly arrive: number;
  readonly partial: number;
  readonly idle: number;
}

/** The rank keeps the men's places around their middle, drawn in to this distance at most (m). */
export const FORMATION_SPREAD_M = 6;
/** A place taken or out of reach: the free cells this far around it are tried, nearest first (m). */
const SLOT_SEARCH_M = 3;
/** A man who cannot strike this turn closes in to this distance of the enemy (m). */
const CLOSE_IN_M = 1.5;

/** The battle with `unitId` standing at `p` (planning only: no reaction shot, no point spent). */
function standing(state: BattleState, unitId: string, p: Vec2): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === unitId ? { ...u, position: p } : u)) };
}

/** The men of the side to play among `unitIds`, alive, nearest to `p` first (then by id). */
function menOf(state: BattleState, unitIds: readonly string[], p: Vec2) {
  return unitIds
    .map((id) => findUnit(state, id))
    .filter((u): u is NonNullable<typeof u> => u !== undefined && u.alive && u.faction === state.activeFaction)
    .sort((a, b) => distance(a.position, p) - distance(b.position, p) || (a.id < b.id ? -1 : 1));
}

/** Cell centres around `p` within SLOT_SEARCH_M, `p` first. */
function around(p: Vec2): Vec2[] {
  const out: Vec2[] = [p];
  const r = SLOT_SEARCH_M;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if ((dx !== 0 || dz !== 0) && Math.hypot(dx, dz) <= r) out.push({ x: p.x + dx, z: p.z + dz });
  return out.sort((a, b) => distance(a, p) - distance(b, p));
}

/** A walk to `target`, or to the nearest free place around it (cut where this turn ends). */
function walkNear(ctx: BattleContext, state: BattleState, unitId: string, target: Vec2) {
  for (const p of around(target)) {
    const r = planAdvance(ctx, state, unitId, p);
    if (r.ok) return r;
  }
  return null;
}

/** The men walk to `target` together, each keeping his place in the rank around their middle. */
export function planGroupMove(ctx: BattleContext, state: BattleState, unitIds: readonly string[], target: Vec2): GroupPlan {
  const men = menOf(state, unitIds, target);
  const middle = men.length === 0 ? target : { x: men.reduce((s, u) => s + u.position.x, 0) / men.length, z: men.reduce((s, u) => s + u.position.z, 0) / men.length };
  const orders: Command[][] = [];
  const walks: MovePlan[] = [];
  let scratch = state;
  let arrive = 0;
  let partial = 0;
  let idle = 0;
  for (const man of men) {
    const off = { x: man.position.x - middle.x, z: man.position.z - middle.z };
    const k = Math.min(1, FORMATION_SPREAD_M / (Math.hypot(off.x, off.z) || 1));
    const walk = walkNear(ctx, scratch, man.id, { x: target.x + off.x * k, z: target.z + off.z * k });
    if (!walk) {
      idle++;
      orders.push([]);
      continue;
    }
    orders.push([{ type: 'move', unitId: man.id, to: walk.plan.destination }]);
    walks.push(walk.plan);
    if (walk.partial) partial++;
    else arrive++;
    scratch = standing(scratch, man.id, walk.plan.destination);
  }
  return { orders, walks, strikes: 0, closeIn: 0, arrive, partial, idle };
}

/** All who can reach `targetId` this turn strike him (the walk first if need be); the others close in. */
export function planGroupStrike(ctx: BattleContext, state: BattleState, unitIds: readonly string[], targetId: string): GroupPlan {
  const target = findUnit(state, targetId);
  if (!target) return { orders: [], walks: [], strikes: 0, closeIn: 0, arrive: 0, partial: 0, idle: unitIds.length };
  const men = menOf(state, unitIds, target.position);
  const orders: Command[][] = [];
  const walks: MovePlan[] = [];
  let scratch = state;
  let strikes = 0;
  let closeIn = 0;
  let idle = 0;
  for (const man of men) {
    const strike = unitType(ctx, man).attack ? planStrike(ctx, scratch, man.id, targetId) : null;
    if (strike) {
      const blow: Command = { type: 'attack', unitId: man.id, targetId };
      orders.push(strike.move ? [{ type: 'move', unitId: man.id, to: strike.move.destination }, blow] : [blow]);
      if (strike.move) {
        walks.push(strike.move);
        scratch = standing(scratch, man.id, strike.move.destination);
      }
      strikes++;
      continue;
    }
    // Out of reach this turn: closer, on his side of the enemy.
    const d = distance(man.position, target.position) || 1;
    const near = { x: target.position.x + ((man.position.x - target.position.x) / d) * CLOSE_IN_M, z: target.position.z + ((man.position.z - target.position.z) / d) * CLOSE_IN_M };
    const walk = walkNear(ctx, scratch, man.id, near);
    if (!walk) {
      idle++;
      orders.push([]);
      continue;
    }
    orders.push([{ type: 'move', unitId: man.id, to: walk.plan.destination }]);
    walks.push(walk.plan);
    closeIn++;
    scratch = standing(scratch, man.id, walk.plan.destination);
  }
  return { orders, walks, strikes, closeIn, arrive: 0, partial: 0, idle };
}
