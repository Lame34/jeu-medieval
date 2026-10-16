import { normalize, type Vec2 } from '../math/vec2.ts';
import { isPassable } from '../nav-grid/nav-grid.ts';
import { Rng, type Seed } from '../rng.ts';
import type { Faction } from '../rules/types.ts';
import type { BattleContext } from './context.ts';
import { initialStructures, NO_WORKS, syncNav } from './structures.ts';
import { conditionsOf, groundOf } from './conditions.ts';
import { fillSites } from './moat.ts';
import { setGround } from './structures.ts';
import { BATTLE_STATE_VERSION, type BattleState, type Scenario, type StructureState, type UnitState, type WorkState } from './types.ts';

export const DEFAULT_MORALE = 70;
const DEFAULT_FACING: Vec2 = { x: 0, z: -1 };
const BATTLE_RNG_LABEL = 'battle';
const WIND_RNG_LABEL = 'wind';
/** Strength range of the drawn wind (0–1). */
const WIND_STRENGTH: readonly [number, number] = [0.3, 1];

export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioError';
  }
}

export function snapToCellCenter(ctx: BattleContext, p: Vec2): Vec2 {
  const cs = ctx.nav.cellSize;
  return { x: (Math.floor(p.x / cs) + 0.5) * cs, z: (Math.floor(p.z / cs) + 0.5) * cs };
}

export function cellIndexOf(ctx: BattleContext, p: Vec2): number {
  const cs = ctx.nav.cellSize;
  return Math.floor(p.z / cs) * ctx.nav.width + Math.floor(p.x / cs);
}

/** The castle at the start: intact, but for the scenario's damaged and fallen structures. */
function startStructures(ctx: BattleContext, scenario: Scenario): StructureState[] {
  const structures = initialStructures(ctx.structures);
  for (const start of scenario.structures ?? []) {
    const i = structures.findIndex((s) => s.id === start.id);
    const def = ctx.structures.find((d) => d.id === start.id);
    if (i < 0 || !def) throw new ScenarioError(`unknown structure "${start.id}"`);
    const f = start.hpFraction ?? 1;
    if (!(f > 0 && f <= 1)) throw new ScenarioError(`structure "${start.id}": hpFraction ${f} outside (0, 1]`);
    structures[i] = start.broken ? { id: start.id, hp: 0, broken: true } : { id: start.id, hp: Math.max(1, Math.round(def.maxHp * f)), broken: false };
  }
  return structures;
}

/** The fascine causeways laid before the battle, sorted by id. */
function startWorks(ctx: BattleContext, scenario: Scenario): readonly WorkState[] {
  if (!scenario.filled || scenario.filled.length === 0) return NO_WORKS;
  const sites = fillSites(ctx);
  const ids = [...new Set(scenario.filled)].sort();
  for (const id of ids) if (!sites.has(id)) throw new ScenarioError(`unknown fill site "${id}"`);
  return ids.map((id) => ({ id, progress: ctx.rules.structures.fillTurns, done: true }));
}

export function createBattle(ctx: BattleContext, seed: Seed, scenario: Scenario): BattleState {
  // Spawns are checked against the intact castle.
  syncNav(ctx, initialStructures(ctx.structures), NO_WORKS);
  const structures = startStructures(ctx, scenario);
  const works = startWorks(ctx, scenario);
  const firstFaction: Faction = scenario.firstFaction ?? 'attacker';
  const moraleOf = (f: Faction) => scenario.morale?.[f] ?? scenario.initialMorale ?? DEFAULT_MORALE;
  const seenIds = new Set<string>();
  const occupied = new Set<number>();
  const units: UnitState[] = [];

  for (const spawn of scenario.units) {
    if (seenIds.has(spawn.id)) throw new ScenarioError(`duplicate unit id "${spawn.id}"`);
    seenIds.add(spawn.id);
    const type = ctx.rules.units[spawn.typeKey];
    if (!type) throw new ScenarioError(`unit "${spawn.id}": unknown type "${spawn.typeKey}"`);
    const position = snapToCellCenter(ctx, spawn.position);
    const cx = Math.floor(position.x / ctx.nav.cellSize);
    const cz = Math.floor(position.z / ctx.nav.cellSize);
    if (!isPassable(ctx.nav, type.movement, cx, cz)) {
      throw new ScenarioError(`unit "${spawn.id}": spawn cell (${cx}, ${cz}) is not passable for ${type.movement}`);
    }
    const cell = cellIndexOf(ctx, position);
    if (occupied.has(cell)) throw new ScenarioError(`unit "${spawn.id}": spawn cell (${cx}, ${cz}) already occupied`);
    occupied.add(cell);
    units.push({
      id: spawn.id,
      typeKey: spawn.typeKey,
      faction: type.faction,
      position,
      facing: normalize(spawn.facing ?? DEFAULT_FACING),
      hp: type.hp,
      ap: type.faction === firstFaction ? type.ap : 0,
      actions: type.faction === firstFaction ? ctx.rules.damage.actionsPerTurn : 0,
      overwatch: null,
      morale: moraleOf(type.faction),
      alive: true,
    });
  }

  units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const root = Rng.create(seed);
  // The wind blows from a direction drawn from the seed (weather changes it from J5).
  const windRng = root.fork(WIND_RNG_LABEL);
  const windAngle = windRng.next() * 2 * Math.PI;
  const wind = { x: Math.sin(windAngle), z: Math.cos(windAngle), strength: WIND_STRENGTH[0] + windRng.next() * (WIND_STRENGTH[1] - WIND_STRENGTH[0]) };
  const { weather, startHour, season } = conditionsOf(ctx.rules, scenario);
  setGround(ctx, groundOf(ctx.rules, { weather, ...(season !== undefined ? { season } : {}) }));
  syncNav(ctx, structures, works);
  return {
    version: BATTLE_STATE_VERSION,
    seedKey: root.seedKey,
    turn: 1,
    turnLimit: scenario.turnLimit ?? ctx.rules.battle.turnLimit,
    activeFaction: firstFaction,
    status: 'ongoing',
    units,
    structures,
    works,
    docks: [],
    wind,
    weather,
    startHour,
    ...(season !== undefined ? { season } : {}),
    fires: [],
    burnt: [],
    ...(scenario.aim ? { aim: scenario.aim } : {}),
    ...(scenario.sworn ? { sworn: true as const } : {}),
    rng: root.fork(BATTLE_RNG_LABEL).getState(),
  };
}
