/**
 * Morale (brief §9.7), 0 to rules.morale.max. Blows and deaths move it: an ally dying nearby, a
 * unit falling below half its HP, a kill. Under `shakenBelow` a unit starts its turn with
 * `shakenApPenalty` fewer AP; under `fleeBelow` it takes no orders and, at the start of its turn,
 * runs to the reachable cell farthest from the enemy. Every unit regains `recoveryPerTurn` at
 * the start of its turn, so a routed unit can rally. A wall segment collapsing shakes the
 * defenders around it (J4); encirclement and fire join later.
 */
import type { GameEvent, MoraleReason } from '../events/types.ts';
import { distance, normalize, sub, type Vec2 } from '../math/vec2.ts';
import { IMPASSABLE } from '../nav-grid/nav-grid.ts';
import type { MoraleRules } from '../rules/types.ts';
import { cellCenter } from '../terrain-data/terrain-data.ts';
import type { BattleContext } from './context.ts';
import { movementArea, planMove, unitType } from './movement.ts';
import type { BattleState, UnitState } from './types.ts';

export type MoraleStanding = 'steady' | 'shaken' | 'fleeing';

export function moraleStanding(rules: MoraleRules, morale: number): MoraleStanding {
  if (morale < rules.fleeBelow) return 'fleeing';
  if (morale < rules.shakenBelow) return 'shaken';
  return 'steady';
}

/** A blow just resolved: who hit whom, and the target's HP before and after. */
export interface BlowOutcome {
  readonly attackerId: string;
  readonly targetId: string;
  readonly hpBefore: number;
  readonly hpAfter: number;
}

function shift(rules: MoraleRules, unit: UnitState, delta: number, reason: MoraleReason, events: GameEvent[]): UnitState {
  const morale = Math.min(rules.max, Math.max(0, unit.morale + delta));
  if (morale === unit.morale) return unit;
  events.push({ type: 'moraleChanged', unitId: unit.id, morale, delta: morale - unit.morale, reason });
  return { ...unit, morale };
}

/** Morale consequences of the blows of one attack (units sorted by id, processed in blow order). */
export function moraleAfterBlows(ctx: BattleContext, units: readonly UnitState[], blows: readonly BlowOutcome[], events: GameEvent[]): UnitState[] {
  const rules = ctx.rules.morale;
  const out = [...units];
  const at = (id: string) => out.findIndex((u) => u.id === id);
  for (const blow of blows) {
    const ti = at(blow.targetId);
    const target = out[ti] as UnitState;
    const woundedHp = unitType(ctx, target).hp * rules.woundedHpFraction;
    if (blow.hpAfter > 0 && blow.hpBefore > woundedHp && blow.hpAfter <= woundedHp) out[ti] = shift(rules, target, -rules.woundedLoss, 'wounded', events);
    if (blow.hpAfter > 0) continue;
    for (let k = 0; k < out.length; k++) {
      const ally = out[k] as UnitState;
      if (!ally.alive || ally.id === target.id || ally.faction !== target.faction) continue;
      if (distance(ally.position, target.position) <= rules.allyDeathRadiusM) out[k] = shift(rules, ally, -rules.allyDeathLoss, 'allyDied', events);
    }
    const ki = at(blow.attackerId);
    const killer = out[ki] as UnitState;
    if (killer.alive) out[ki] = shift(rules, killer, rules.killGain, 'kill', events);
  }
  return out;
}

/** Defenders shaken by a wall segment collapsing near them (brief §9.7). */
export function moraleAfterCollapse(ctx: BattleContext, units: readonly UnitState[], at: Vec2, faction: UnitState['faction'], events: GameEvent[]): UnitState[] {
  const s = ctx.rules.structures;
  return units.map((u) =>
    u.alive && u.faction === faction && distance(u.position, at) <= s.collapseMoraleRadiusM ? shift(ctx.rules.morale, u, -s.collapseMoraleLoss, 'wallCollapsed', events) : u,
  );
}

function nearestEnemyDistance(state: BattleState, unit: UnitState, p: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (const u of state.units) if (u.alive && u.faction !== unit.faction) best = Math.min(best, distance(u.position, p));
  return best;
}

/** Reachable cell farthest from the nearest enemy (ties: cheaper, then lower index). */
function fleeDestination(ctx: BattleContext, state: BattleState, unit: UnitState): Vec2 | null {
  const area = movementArea(ctx, state, unit.id);
  if (!area) return null;
  const { field } = area;
  const occupied = new Set(state.units.filter((u) => u.alive).map((u) => `${u.position.x},${u.position.z}`));
  let best: { p: Vec2; score: number; cost: number } | null = null;
  for (let wz = 0; wz < field.depth; wz++) {
    for (let wx = 0; wx < field.width; wx++) {
      const cost = field.cost[wz * field.width + wx] as number;
      if (cost === IMPASSABLE || cost > unit.ap) continue;
      const p = cellCenter(ctx.terrain, field.minCx + wx, field.minCz + wz);
      if (occupied.has(`${p.x},${p.z}`)) continue;
      const score = nearestEnemyDistance(state, unit, p);
      if (!best || score > best.score || (score === best.score && cost < best.cost)) best = { p, score, cost };
    }
  }
  if (!best || best.score <= nearestEnemyDistance(state, unit, unit.position)) return null;
  return best.p;
}

/**
 * Start of `faction`'s turn: morale recovery, AP and attacks restored (minus the shaken
 * penalty), then routed units run. Returns the new state; events are appended.
 */
export function startTurn(ctx: BattleContext, state: BattleState, faction: UnitState['faction'], events: GameEvent[]): BattleState {
  const rules = ctx.rules.morale;
  let units = state.units.map((u) => {
    if (u.faction !== faction || !u.alive) return u;
    const recovered = shift(rules, u, rules.recoveryPerTurn, 'recovery', events);
    const penalty = moraleStanding(rules, recovered.morale) === 'shaken' ? rules.shakenApPenalty : 0;
    // A guard set last turn expires when the unit's own turn comes back.
    return { ...recovered, ap: Math.max(0, unitType(ctx, u).ap - penalty), actions: ctx.rules.damage.actionsPerTurn, overwatch: null };
  });
  let next: BattleState = { ...state, units };
  for (const unit of units) {
    if (unit.faction !== faction || !unit.alive || moraleStanding(rules, unit.morale) !== 'fleeing') continue;
    const to = fleeDestination(ctx, next, unit);
    const plan = to ? planMove(ctx, next, unit.id, to) : null;
    if (plan?.ok) {
      const { path } = plan.plan;
      const last = path[path.length - 1] as Vec2;
      const beforeLast = (path[path.length - 2] ?? unit.position) as Vec2;
      const dir = normalize(sub(last, beforeLast));
      events.push({ type: 'unitMoved', unitId: unit.id, path, apCost: plan.plan.apCost, apSpent: plan.plan.apSpent, fleeing: true });
      units = next.units.map((u) => (u.id === unit.id ? { ...u, position: plan.plan.destination, facing: dir.x === 0 && dir.z === 0 ? u.facing : dir, ap: 0, actions: 0 } : u));
    } else {
      units = next.units.map((u) => (u.id === unit.id ? { ...u, ap: 0, actions: 0 } : u));
    }
    next = { ...next, units };
  }
  return next;
}
