/**
 * Synthetic castle for the siege tests (70 x 20 cells of 1 m, flat Plain unless stated):
 *
 *   x = 10..13   moat (relief dips MOAT_DEPTH_M below the banks), all z
 *   x = 14..19   the bank in front of the wall (attackers' side)
 *   x = 20       the curtain: wall-walk segments S0 (z 0..7) and S1 (z 11..19) on a deck of
 *                WALL_DECK_M, and the gatehouse passage (z 8..10, blocked Wall layer)
 *   x >= 21      the courtyard (defenders' side)
 *
 * The drawbridge spans the moat at the gate rows (x 10..13, z 8..10) with its deck level with the
 * sill (DECK_HEIGHT_M = 0). Everything the siege rules need is built here from plain data, not
 * from generated maps, so a test reads as a small diagram.
 */
import {
  TerrainLayer,
  createBattle,
  createBattleContext,
  createTerrainData,
  setHeightAtCorner,
  setLayer,
  type BattleContext,
  type BattleState,
  type GameRules,
  type Scenario,
  type UnitSpawn,
} from '@core/index.ts';
import type { StructureDef } from '@core/battle/structures.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, fillRect } from './helpers.ts';

export const MAP_W = 70;
export const MAP_D = 20;
export const MOAT_X0 = 10;
export const MOAT_X1 = 13;
export const WALL_X = 20;
export const GATE_Z0 = 8;
export const GATE_Z1 = 10;
export const S0_Z1 = 7;
export const S1_Z0 = 11;
export const WALL_DECK_M = 4;
export const MOAT_DEPTH_M = -0.25;
export const DECK_HEIGHT_M = 0;

export const IDS = {
  bridge: 'drawbridge:g',
  gate: 'gate:g',
  portcullis: 'portcullis:g',
  wallA: 'wall:s:0',
  wallB: 'wall:s:1',
  winch: 'def-winch',
  ram: 'att-ram',
  catapult: 'att-cat',
  soldier: 'att-sol',
  guardA: 'def-g0',
  guardB: 'def-g1',
  near: 'def-near',
  far: 'def-far',
} as const;

function cellsRect(x0: number, z0: number, x1: number, z1: number): number[] {
  const out: number[] = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(z * MAP_W + x);
  return out;
}

export function buildFixture(rules: GameRules = DEFAULT_RULES, units: readonly UnitSpawn[] = defaultUnits()): { ctx: BattleContext; scenario: Scenario; defs: StructureDef[] } {
  const t = createTerrainData(MAP_W, MAP_D, 1);
  t.heights.fill(0);
  for (let iz = 0; iz <= MAP_D; iz++) for (let ix = MOAT_X0; ix <= MOAT_X1 + 1; ix++) setHeightAtCorner(t, ix, iz, MOAT_DEPTH_M);
  fillRect(t, MOAT_X0, 0, MOAT_X1, MAP_D - 1, TerrainLayer.Moat);
  fillRect(t, WALL_X, 0, WALL_X, MAP_D - 1, TerrainLayer.Wall);
  for (let z = 0; z < MAP_D; z++) setLayer(t, WALL_X, z, z >= GATE_Z0 && z <= GATE_Z1 ? TerrainLayer.Wall : TerrainLayer.Rampart);
  const deck = new Float32Array(MAP_W * MAP_D);
  for (let z = 0; z < MAP_D; z++) if (z < GATE_Z0 || z > GATE_Z1) deck[z * MAP_W + WALL_X] = WALL_DECK_M;
  const gateCells = cellsRect(WALL_X, GATE_Z0, WALL_X, GATE_Z1);
  const center = centerOf(WALL_X, (GATE_Z0 + GATE_Z1) / 2);
  const defs: StructureDef[] = [
    { id: IDS.bridge, kind: 'drawbridge', material: 'wood', maxHp: 0, cells: cellsRect(MOAT_X0, GATE_Z0, MOAT_X1, GATE_Z1), center: { x: 12, z: 9.5 }, gateId: 'g', operatorId: IDS.winch, deckHeightM: DECK_HEIGHT_M },
    { id: IDS.gate, kind: 'gate', material: 'wood', maxHp: rules.structures.gateHp, cells: gateCells, center, gateId: 'g' },
    { id: IDS.portcullis, kind: 'portcullis', material: 'heavy', maxHp: rules.structures.portcullisHp, cells: gateCells, center, gateId: 'g' },
    { id: IDS.wallA, kind: 'wall', material: 'stone', maxHp: rules.structures.wallHp, cells: cellsRect(WALL_X, 0, WALL_X, S0_Z1), center: { x: 20.5, z: 4 } },
    { id: IDS.wallB, kind: 'wall', material: 'stone', maxHp: rules.structures.wallHp, cells: cellsRect(WALL_X, S1_Z0, WALL_X, MAP_D - 1), center: { x: 20.5, z: 15.5 } },
  ];
  return { ctx: createBattleContext(t, rules, deck, defs), scenario: { units }, defs };
}

export function spawn(id: string, typeKey: string, cx: number, cz: number): UnitSpawn {
  return { id, typeKey, position: centerOf(cx, cz) };
}

export function defaultUnits(): UnitSpawn[] {
  return [
    spawn(IDS.ram, 'ram', 19, 9),
    spawn(IDS.catapult, 'catapult', 16, 15),
    spawn(IDS.soldier, 'soldier', 16, 5),
    spawn(IDS.winch, 'towerArcher', 30, 9),
    spawn(IDS.guardA, 'wallGuard', 20, 3),
    spawn(IDS.guardB, 'wallGuard', 20, 5),
    spawn(IDS.near, 'militia', 30, 3),
    spawn(IDS.far, 'militia', 60, 15),
  ];
}

/** `state` with the given structures broken (hp 0). */
export function withBroken(state: BattleState, ...ids: string[]): BattleState {
  return { ...state, structures: state.structures.map((s) => (ids.includes(s.id) ? { ...s, hp: 0, broken: true } : s)) };
}

export function withUnit(state: BattleState, id: string, patch: Partial<BattleState['units'][number]>): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) };
}

export function freshBattle(seed = 'siege-fixture'): { ctx: BattleContext; scenario: Scenario; state: BattleState; defs: StructureDef[] } {
  const f = buildFixture();
  return { ...f, state: createBattle(f.ctx, seed, f.scenario) };
}
