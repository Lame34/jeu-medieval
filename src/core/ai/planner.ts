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
 *
 * Siege (J4): engines weigh blows against the castle's structures (expected damage, plus the
 * chance to bring one down); a ram closes in on the gate it can strike, and waits out of the
 * fight while none is exposed; a drawbridge's winch operator stays at the winch.
 *
 * Tactics (J5, tactics.ts): fires put out or set, the garrison behind an open breach, sallies
 * against an engine left alone.
 */
import { previewAttack, type AttackPreview } from '../battle/combat.ts';
import type { BattleContext } from '../battle/context.ts';
import { cellIndexOf } from '../battle/create.ts';
import { moraleStanding } from '../battle/morale.ts';
import { movementArea, occupancy, unitType } from '../battle/movement.ts';
import { canOverwatch, threatsAt } from '../battle/overwatch.ts';
import { distanceToCells, GATES_ONLY_TAG, shieldOf, SIEGE_ENGINE_TAG, structuresInReach, type StructureAttackPreview } from '../battle/siege.ts';
import { isBroken, syncNav } from '../battle/structures.ts';
import { dockOf, TOWER_TAG } from '../battle/siege-tower.ts';
import { FILL_MOAT_TAG } from '../battle/siege-works.ts';
import { breachGuardValue, cellsWithinReach, climbOrigins, dockOrigins, fireDecisions, sallyTarget, stagingOrigins, towerDecisions, worksDecisions, worthyFillSites } from './tactics.ts';
import type { BattleState, UnitState } from '../battle/types.ts';
import { applyCommand } from '../commands/apply.ts';
import type { Command } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import { distance, sub, type Vec2 } from '../math/vec2.ts';
import { coverLevelAt, IMPASSABLE } from '../nav-grid/nav-grid.ts';
import { computeCostField } from '../nav-grid/reachable.ts';
import type { Faction, MovementProfile } from '../rules/types.ts';
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
  /** Reward per AP of travel gained towards the nearest reachable enemy when no attack is possible. */
  approachPerAp: 3,
  /** Value of ending a move on guard (a possible reaction shot). */
  guardBonus: 1,
  /**
   * Reward per AP gained towards an objective the unit exists for (a ram's gate, a sapper's
   * causeway): worth the exposure of the approach, as an engine's AP buys several metres.
   */
  objectivePerAp: 10,
  /** Defenders leave their spot only for enemies closer than this (m). */
  defenderEngageRadiusM: 25,
  /** Value per expected point of structure damage, and of bringing a structure down. */
  structureDamage: 0.5,
  breachBonus: 30,
} as const;

/** Horizon (AP) of the approach fields: enemies farther than this by the ground are ignored. */
const APPROACH_BUDGET_AP = 120;
/**
 * The approach fields stop this many AP (per AP of our fastest unit) past our farthest unit: a
 * move's AP buys at most this much field cost (the field runs uphill/downhill reversed).
 */
const APPROACH_SLACK_PER_AP = 3;

/** Spots scored per unit: its own cell plus the cheapest reachable cells on a coarse lattice. */
const MAX_CANDIDATES = 160;
const LATTICE_STEP_CELLS = 2;

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

function structureAttackValue(state: BattleState, preview: StructureAttackPreview): number {
  const hp = state.structures.find((st) => st.id === preview.structureId)?.hp ?? 0;
  return expectedDamage(preview.blow) * AI_WEIGHTS.structureDamage + killChance(preview.blow, hp) * AI_WEIGHTS.breachBonus;
}

/** A winch operator keeps to the winch while their drawbridge is raised. */
function holdsPost(ctx: BattleContext, state: BattleState, unit: UnitState): boolean {
  return ctx.structures.some((d) => d.operatorId === unit.id && !isBroken(state.structures, d.id));
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
  // Engines working at contact also keep the cells next to the structures they could strike.
  const type = unitType(ctx, unit);
  const breachable = type.tags.includes(SIEGE_ENGINE_TAG) && type.attack?.rangeM === 0
    ? ctx.structures.filter((d) => d.maxHp > 0 && !isBroken(state.structures, d.id)).map((d) => d.cells)
    : [];
  if (type.tags.includes(FILL_MOAT_TAG)) breachable.push(...worthyFillSites(ctx, state).map((s) => s.cells));
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
      const nextToTarget = enemies.some((e) => distance(e.position, position) <= reach) || breachable.some((cells) => distanceToCells(ctx, cells, position) <= reach);
      if (!nextToTarget && (cx % LATTICE_STEP_CELLS !== 0 || cz % LATTICE_STEP_CELLS !== 0)) continue;
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
  return coverBonus - exposure * AI_WEIGHTS.selfDamage + breachGuardValue(ctx, state, unit, at);
}

interface Decision {
  readonly commands: Command[];
  readonly score: number;
}

/**
 * Travel cost (AP) from every cell to the nearest enemy of `faction`, per movement profile:
 * units close in on enemies they can actually reach, not on a garrison behind a moat.
 */
export class ApproachFields {
  private readonly fields = new Map<MovementProfile, Float32Array>();
  private readonly objectiveFields = new Map<string, Float32Array | null>();
  private readonly ctx: BattleContext;
  private readonly state: BattleState;
  private readonly faction: Faction;

  constructor(ctx: BattleContext, state: BattleState, faction: Faction) {
    this.ctx = ctx;
    this.state = state;
    this.faction = faction;
  }

  costAt(profile: MovementProfile, p: Vec2): number {
    let field = this.fields.get(profile);
    if (!field) {
      const origins = this.state.units.filter((u) => u.alive && u.faction !== this.faction).map((u) => cellIndexOf(this.ctx, u.position));
      if (this.faction === 'attacker') origins.push(...stagingOrigins(this.ctx, this.state, profile), ...climbOrigins(this.ctx, this.state, profile));
      // Exact around our own units of this profile (their moves stay within their AP), then stop.
      const ours = this.state.units.filter((u) => u.alive && u.faction === this.faction && unitType(this.ctx, u).movement === profile);
      const maxAp = ours.reduce((m, u) => Math.max(m, unitType(this.ctx, u).ap), 0);
      field = computeCostField(this.ctx.paths, profile, origins, APPROACH_BUDGET_AP, {
        cells: ours.map((u) => cellIndexOf(this.ctx, u.position)),
        slackAp: maxAp * APPROACH_SLACK_PER_AP + 1,
      });
      this.fields.set(profile, field);
    }
    return field[cellIndexOf(this.ctx, p)] as number;
  }

  /**
   * Travel cost to the nearest cell from which the objective is worked, null while there is none:
   * a ram strikes an exposed gate or portcullis (intact, nothing intact in front of it), a sapper
   * works a worthy causeway, a tower docks at an intact segment.
   */
  objectiveCostAt(objective: Objective, profile: MovementProfile, p: Vec2): number | null {
    const key = `${objective}:${profile}`;
    let field = this.objectiveFields.get(key);
    if (field === undefined) {
      const ctx = this.ctx;
      const reach = ctx.rules.damage.meleeReachM;
      const origins: number[] = [];
      if (objective === 'gate') {
        for (const def of ctx.structures) {
          if ((def.kind !== 'gate' && def.kind !== 'portcullis') || isBroken(this.state.structures, def.id) || shieldOf(ctx, this.state.structures, def)) continue;
          origins.push(...cellsWithinReach(ctx, profile, def.cells, reach));
        }
      } else if (objective === 'works') {
        for (const s of worthyFillSites(ctx, this.state)) origins.push(...cellsWithinReach(ctx, profile, s.cells, reach));
      } else origins.push(...dockOrigins(ctx, this.state, profile));
      const tag = OBJECTIVE_TAG[objective];
      const ours = this.state.units.filter((u) => u.alive && u.faction === this.faction && unitType(ctx, u).tags.includes(tag));
      field = origins.length === 0 ? null : computeCostField(ctx.paths, profile, origins, APPROACH_BUDGET_AP, { cells: ours.map((u) => cellIndexOf(ctx, u.position)), slackAp: APPROACH_SLACK_PER_AP * 2 + 1 });
      this.objectiveFields.set(key, field);
    }
    return field ? (field[cellIndexOf(this.ctx, p)] as number) : null;
  }

  /** The ram's objective field (see objectiveCostAt). */
  gateCostAt(profile: MovementProfile, p: Vec2): number | null {
    return this.objectiveCostAt('gate', profile, p);
  }
}

/** What a siege unit exists for, and the tag that marks it. */
type Objective = 'gate' | 'works' | 'dock';
const OBJECTIVE_TAG: Readonly<Record<Objective, string>> = { gate: GATES_ONLY_TAG, works: FILL_MOAT_TAG, dock: TOWER_TAG };

/** The unit's objective, if it has one: rams, sappers and towers still to dock. */
function objectiveOf(state: BattleState, unit: UnitState, tags: readonly string[]): Objective | null {
  if (tags.includes(GATES_ONLY_TAG)) return 'gate';
  if (tags.includes(FILL_MOAT_TAG)) return 'works';
  if (tags.includes(TOWER_TAG) && !dockOf(state, unit.id)) return 'dock';
  return null;
}

/** The commands one unit issues this turn (possibly none). */
export function decideUnit(ctx: BattleContext, state: BattleState, unit: UnitState, approach = new ApproachFields(ctx, state, unit.faction)): Command[] {
  if (!unit.alive || unit.faction !== state.activeFaction || moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return [];
  const type = unitType(ctx, unit);
  const actionAp = ctx.rules.damage.attackApCost;
  const canAct = type.attack !== null && unit.actions > 0;
  const budget = canAct ? unit.ap - actionAp : unit.ap;
  const fromCost = approach.costAt(type.movement, unit.position);
  let best: Decision | null = null;
  const consider = (d: Decision) => {
    if (!best || d.score > best.score) best = d;
  };
  const siegeEngine = type.tags.includes(SIEGE_ENGINE_TAG);
  // Siege units go for their objective: a ram for the exposed gate, a sapper for a causeway that
  // is wanted, a tower for a wall it can reach. Rams and towers hold back while theirs is out of
  // reach (a docked tower stays put); a sapper without one fights as infantry.
  const objective = objectiveOf(state, unit, type.tags);
  const objectiveFrom = objective ? approach.objectiveCostAt(objective, type.movement, unit.position) : null;
  const toObjective = objectiveFrom !== null && objectiveFrom !== IMPASSABLE;
  const tower = type.tags.includes(TOWER_TAG);
  const holding = holdsPost(ctx, state, unit) || (!toObjective && (objective === 'gate' || objective === 'dock')) || (tower && objective === null);
  // An engine left alone draws a sally from defenders farther out than they usually engage.
  const sally = sallyTarget(ctx, state, unit) !== null;
  // Fires to put out or to set, works to carry on, from where the unit stands.
  for (const d of [...fireDecisions(ctx, state, unit), ...worksDecisions(ctx, state, unit), ...towerDecisions(ctx, state, unit)]) consider({ commands: d.commands, score: d.score + spotValue(ctx, state, unit, unit.position) });

  for (const c of candidates(ctx, state, unit, Math.max(0, budget))) {
    if (holding && c.cost > 0) continue;
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
      if (siegeEngine) {
        for (const blow of structuresInReach(ctx, there, unit.id)) {
          consider({ commands: [...move, { type: 'attackStructure', unitId: unit.id, structureId: blow.structureId }], score: base + structureAttackValue(there, blow) });
        }
      }
    }
    // No shot from here: close in, and shooters end the move on guard. Defenders hold their
    // ground until the enemy comes within engagement range.
    const nearest = nearestEnemy(there, moved, c.position);
    if (nearest) {
      const from = toObjective ? (objectiveFrom as number) : fromCost;
      const toCost = toObjective && objective ? (approach.objectiveCostAt(objective, type.movement, c.position) as number) : approach.costAt(type.movement, c.position);
      const gained = from === IMPASSABLE || toCost === IMPASSABLE ? 0 : from - toCost;
      const engaged = unit.faction === 'attacker' || sally || distance(unit.position, nearest.position) <= AI_WEIGHTS.defenderEngageRadiusM;
      const guarding = canOverwatch(ctx, moved) && moved.actions > 0 && apLeft >= actionAp;
      const guard: Command[] = guarding ? [{ type: 'overwatch', unitId: unit.id, direction: sub(nearest.position, c.position) }] : [];
      const perAp = toObjective ? AI_WEIGHTS.objectivePerAp : AI_WEIGHTS.approachPerAp;
      consider({ commands: [...move, ...guard], score: base + (engaged || toObjective ? gained * perAp : 0) + (guarding ? AI_WEIGHTS.guardBonus : 0) });
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
  syncNav(ctx, state.structures, state.works);
  let current = state;
  const commands: Command[] = [];
  const events: GameEvent[] = [];
  const ids = state.units.filter((u) => u.faction === faction).map((u) => u.id);
  // Enemies do not move during our turn: one set of approach fields serves every unit.
  const approach = new ApproachFields(ctx, state, faction);
  for (const id of ids) {
    const unit = current.units.find((u) => u.id === id) as UnitState;
    for (const command of decideUnit(ctx, current, unit, approach)) {
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
