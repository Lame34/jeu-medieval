import { normalize, type Vec2 } from '../math/vec2.ts';
import { isPassable } from '../nav-grid/nav-grid.ts';
import { Rng, type Seed } from '../rng.ts';
import type { Faction } from '../rules/types.ts';
import type { BattleContext } from './context.ts';
import { BATTLE_STATE_VERSION, type BattleState, type Scenario, type UnitState } from './types.ts';

export const DEFAULT_MORALE = 70;
const DEFAULT_FACING: Vec2 = { x: 0, z: -1 };
const BATTLE_RNG_LABEL = 'battle';

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

export function createBattle(ctx: BattleContext, seed: Seed, scenario: Scenario): BattleState {
  const firstFaction: Faction = scenario.firstFaction ?? 'attacker';
  const morale = scenario.initialMorale ?? DEFAULT_MORALE;
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
      morale,
      alive: true,
    });
  }

  units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const root = Rng.create(seed);
  return {
    version: BATTLE_STATE_VERSION,
    seedKey: root.seedKey,
    turn: 1,
    activeFaction: firstFaction,
    status: 'ongoing',
    units,
    rng: root.fork(BATTLE_RNG_LABEL).getState(),
  };
}
