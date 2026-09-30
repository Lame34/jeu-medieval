/**
 * Basic utility AI (brief §9.6, J3). Deterministic and fair: it sees the same state as the
 * player and issues ordinary commands through applyCommand. For each unit, in id order, it
 * scores a bounded set of reachable spots (keeping the AP for an action):
 *
 *   score = best attack value from the spot − exposure to enemy shooters + cover − travel cost
 *
 * An attack's value is its expected damage, plus a bonus for the chance to kill, weighted by the
 * target's priority (siege engines, wounded units), minus the riposte it would draw. Without a
 * target, shooters stand guard towards the nearest enemy and melee units close in. Commands are
 * applied one by one, so every unit plans against the positions its comrades just took.
 */
import { previewAttack, type AttackPreview } from '../battle/combat.ts';
import type { BattleContext } from '../battle/context.ts';
import { cellIndexOf } from '../battle/create.ts';
import { moraleStanding } from '../battle/morale.ts';
import { movementArea, occupancy, unitType } from '../battle/movement.ts';
import { canOverwatch, threatsAt } from '../battle/overwatch.ts';
import type { BattleState, UnitState } from '../battle/types.ts';
import { applyCommand } from '../commands/apply.ts';
import type { Command } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import { distance, sub, type Vec2 } from '../math/vec2.ts';
import { coverLevelAt, IMPASSABLE } from '../nav-grid/nav-grid.ts';
import type { Faction } from '../rules/types.ts';
import { cellCenter } from '../terrain-data/terrain-data.ts';

/** Utility weights (tuned in J7 by simulated battles). */
export const AI_WEIGHTS = {
  /** Value of a certain kill, in damage points. */
  killBonus: 12,
  /** Priority factor of siege engines and of wounded targets (below half HP). */
  siegeEnginePriority: 2,
  woundedPriority: 1.4,
  /** Weight of the damage the unit itself would take (riposte, enemy shots next turn). */
  selfDamage: 0.8,
  /** Value per point of cover penalty the spot imposes on the nearest enemy's shots. */
  coverValue: 10,
  /** Cost per AP of travel (prefers short moves at equal value). */
  travelPerAp: 0.3,
  /** Reward per metre gained towards the nearest enemy when no attack is possible. */
  approachPerM: 0.5,
  /** Value of ending a move on guard (a possible reaction shot). */
  guardBonus: 1,
  /** Defenders leave their spot only for enemies closer than this (m). */
  defenderEngageRadiusM: 25,
} as const;

/** Spots scored per unit: its own cell plus the cheapest reachable cells on a coarse lattice. */
const MAX_CANDIDATES = 160;
const LATTICE_STEP_CELLS = 2;
const SIEGE_ENGINE_TAG = 'siegeEngine';

interface Candidate {
  readonly position: Vec2;
  readonly cost: number;
  readonly index: number;
}

function expectedDamage(odds: AttackPreview['blow']): number {
  const d = odds.damage;
  return odds.hitChance * ((1 - odds.critChance) * d.min + odds.critChance * d.max);
}

function killChance(odds: AttackPreview['blow'], hp: number): number {
  if (odds.damage.min >= hp) return odds.hitChance;
  if (odds.damage.max >= hp) return odds.hitChance * odds.critChance;
  return 0;
}

function attackValue(ctx: BattleContext, state: BattleState, preview: AttackPreview): number {
  const target = state.units.find((u) => u.id === preview.targetId) as UnitState;
  const type = unitType(ctx, target);
  let priority = 1;
  if (type.tags.includes(SIEGE_ENGINE_TAG)) priority *= AI_WEIGHTS.siegeEnginePriority;
  if (target.hp <= type.hp * ctx.rules.morale.woundedHpFraction) priority *= AI_WEIGHTS.woundedPriority;
  const gain = (expectedDamage(preview.blow) + killChance(preview.blow, target.hp) * AI_WEIGHTS.killBonus) * priority;
  const risk = preview.riposte ? expectedDamage(preview.riposte) * AI_WEIGHTS.selfDamage : 0;
  return gain - risk;
}

function withUnitAt(state: BattleState, unit: UnitState, position: Vec2, ap: number): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === unit.id ? { ...u, position, ap } : u)) };
}

function candidates(ctx: BattleContext, state: BattleState, unit: UnitState, budget: number): Candidate[] {
  const area = movementArea(ctx, state, unit.id);
  const own: Candidate = { position: unit.position, cost: 0, index: cellIndexOf(ctx, unit.position) };
  if (!area) return [own];
  const { field } = area;
  const occupied = occupancy(ctx, state);
  const enemies = state.units.filter((u) => u.alive && u.faction !== unit.faction);
  const reach = ctx.rules.damage.meleeReachM;
  const out: Candidate[] = [];
  for (let wz = 0; wz < field.depth; wz++) {
    for (let wx = 0; wx < field.width; wx++) {
      const cost = field.cost[wz * field.width + wx] as number;
      if (cost === IMPASSABLE || cost <= 0 || cost > budget) continue;
      const cx = field.minCx + wx;
      const cz = field.minCz + wz;
      const index = cz * ctx.nav.width + cx;
      if (occupied.has(index)) continue;
      const position = cellCenter(ctx.terrain, cx, cz);
      const nextToEnemy = enemies.some((e) => distance(e.position, position) <= reach);
      if (!nextToEnemy && (cx % LATTICE_STEP_CELLS !== 0 || cz % LATTICE_STEP_CELLS !== 0)) continue;
      out.push({ position, cost, index });
    }
  }
  out.sort((a, b) => a.cost - b.cost || a.index - b.index);
  return [own, ...out.slice(0, MAX_CANDIDATES - 1)];
}

function nearestEnemy(state: BattleState, unit: UnitState, from: Vec2): UnitState | null {
  let best: UnitState | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of state.units) {
    if (!u.alive || u.faction === unit.faction) continue;
    const d = distance(u.position, from);
    if (d < bestD || (d === bestD && best && u.id < best.id)) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

/** Enemy damage expected at a spot next turn, and the cover it offers against the nearest shooter. */
function spotValue(ctx: BattleContext, state: BattleState, unit: UnitState, at: Vec2): number {
  let exposure = 0;
  for (const threat of threatsAt(ctx, state, unit, at)) {
    const enemy = state.units.find((u) => u.id === threat.enemyId) as UnitState;
    const attack = unitType(ctx, enemy).attack;
    if (attack) exposure += threat.hitChance * attack.power;
  }
  const nearest = nearestEnemy(state, unit, at);
  const coverBonus = nearest ? ctx.rules.damage.coverPenalty[coverLevelAt(ctx.nav, cellIndexOf(ctx, at))] * AI_WEIGHTS.coverValue : 0;
  return coverBonus - exposure * AI_WEIGHTS.selfDamage;
}

interface Decision {
  readonly commands: Command[];
  readonly score: number;
}

/** The commands one unit issues this turn (possibly none). */
export function decideUnit(ctx: BattleContext, state: BattleState, unit: UnitState): Command[] {
  if (!unit.alive || unit.faction !== state.activeFaction || moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return [];
  const type = unitType(ctx, unit);
  const actionAp = ctx.rules.damage.attackApCost;
  const canAct = type.attack !== null && unit.actions > 0;
  const budget = canAct ? unit.ap - actionAp : unit.ap;
  let best: Decision | null = null;
  const consider = (d: Decision) => {
    if (!best || d.score > best.score) best = d;
  };

  for (const c of candidates(ctx, state, unit, Math.max(0, budget))) {
    const apLeft = unit.ap - Math.ceil(c.cost);
    const there = c.cost > 0 ? withUnitAt(state, unit, c.position, apLeft) : state;
    const moved = there.units.find((u) => u.id === unit.id) as UnitState;
    const move: Command[] = c.cost > 0 ? [{ type: 'move', unitId: unit.id, to: c.position }] : [];
    const base = spotValue(ctx, there, moved, c.position) - c.cost * AI_WEIGHTS.travelPerAp;
    if (canAct) {
      for (const enemy of there.units) {
        if (!enemy.alive || enemy.faction === unit.faction) continue;
        const preview = previewAttack(ctx, there, unit.id, enemy.id);
        if (!preview.ok) continue;
        consider({ commands: [...move, { type: 'attack', unitId: unit.id, targetId: enemy.id }], score: base + attackValue(ctx, there, preview.preview) });
      }
    }
    // No shot from here: close in, and shooters end the move on guard. Defenders hold their
    // ground until the enemy comes within engagement range.
    const nearest = nearestEnemy(there, moved, c.position);
    if (nearest) {
      const gained = distance(unit.position, nearest.position) - distance(c.position, nearest.position);
      const engaged = unit.faction === 'attacker' || distance(unit.position, nearest.position) <= AI_WEIGHTS.defenderEngageRadiusM;
      const holding = canOverwatch(ctx, moved) && moved.actions > 0 && apLeft >= actionAp;
      const guard: Command[] = holding ? [{ type: 'overwatch', unitId: unit.id, direction: sub(nearest.position, c.position) }] : [];
      consider({ commands: [...move, ...guard], score: base + (engaged ? gained * AI_WEIGHTS.approachPerM : 0) + (holding ? AI_WEIGHTS.guardBonus : 0) });
    }
  }
  return (best as Decision | null)?.commands ?? [];
}

export interface AiTurn {
  readonly state: BattleState;
  readonly commands: readonly Command[];
  readonly events: readonly GameEvent[];
}

/** Plays `faction`'s whole turn (ending it). Rejected commands are skipped, never retried. */
export function playTurn(ctx: BattleContext, state: BattleState, faction: Faction): AiTurn {
  if (state.activeFaction !== faction || state.status !== 'ongoing') return { state, commands: [], events: [] };
  let current = state;
  const commands: Command[] = [];
  const events: GameEvent[] = [];
  const ids = state.units.filter((u) => u.faction === faction).map((u) => u.id);
  for (const id of ids) {
    const unit = current.units.find((u) => u.id === id) as UnitState;
    for (const command of decideUnit(ctx, current, unit)) {
      const result = applyCommand(ctx, current, command);
      commands.push(command);
      events.push(...result.events);
      current = result.state;
      if (result.rejection || current.status !== 'ongoing') break;
    }
    if (current.status !== 'ongoing') break;
  }
  if (current.status === 'ongoing') {
    const end = applyCommand(ctx, current, { type: 'endTurn' });
    commands.push({ type: 'endTurn' });
    events.push(...end.events);
    current = end.state;
  }
  return { state: current, commands, events };
}
