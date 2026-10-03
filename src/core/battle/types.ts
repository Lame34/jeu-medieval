import type { Vec2 } from '../math/vec2.ts';
import type { RngState } from '../rng.ts';
import type { Faction } from '../rules/types.ts';
import type { Weather } from './conditions.ts';

/** 9: heroes' cooldowns and buffs. 8: weather and start hour. 7: turn limit (relief). 6: wind and fire. 5: siege-tower docks. 4: sappers' works. 3: castle structures (J4). 2: units carry the attacks left this turn (J3 combat). */
export const BATTLE_STATE_VERSION = 9;

export type BattleStatus = 'ongoing' | 'attackerWon' | 'defenderWon';

export interface UnitState {
  readonly id: string;
  readonly typeKey: string;
  readonly faction: Faction;
  /** Cell centre in world metres (units always stand at a cell centre). */
  readonly position: Vec2;
  /** Unit-length facing direction on the ground plane. */
  readonly facing: Vec2;
  readonly hp: number;
  readonly ap: number;
  /** Attacks left this turn. */
  readonly actions: number;
  /** Overwatch cone direction (unit length) while on guard; null otherwise. */
  readonly overwatch: Vec2 | null;
  readonly morale: number;
  readonly alive: boolean;
  /** Heroes: own turns left before each ability can be used again (absent: all ready). */
  readonly cooldowns?: Readonly<Record<string, number>>;
  /** Until the end of the side's turn (a hero's volley, calibration). */
  readonly buffs?: readonly UnitBuff[];
}

/** A hero ability's effect on a unit until the end of its side's turn. */
export interface UnitBuff {
  readonly source: string;
  /** Added to the hit chance of its shots. */
  readonly accuracy: number;
  /** Its shots are not deflected by the wind (an engine calibrated by the master engineer). */
  readonly windImmune: boolean;
}

/** A castle structure's condition (definitions live in the context). */
export interface StructureState {
  readonly id: string;
  readonly hp: number;
  /** Breached, smashed, or (drawbridge) lowered. */
  readonly broken: boolean;
}

/** A sappers' work site (a moat slot being filled, a segment being undermined). */
export interface WorkState {
  readonly id: string;
  /** Turns of work done. */
  readonly progress: number;
  readonly done: boolean;
}

/** A siege tower docked against a curtain segment, and the units it carried up this turn. */
export interface DockState {
  readonly towerId: string;
  readonly structureId: string;
  readonly climbs: number;
}

/** A burning cell and the rounds of fuel it has left. */
export interface FireState {
  readonly cell: number;
  readonly turnsLeft: number;
}

/** The battle's wind: a unit direction on the ground and its strength (0–1). */
export interface WindState {
  readonly x: number;
  readonly z: number;
  readonly strength: number;
}

/** Fully serialisable battle state. A battle is `seed + scenario + commands`. */
export interface BattleState {
  readonly version: typeof BATTLE_STATE_VERSION;
  readonly seedKey: number;
  readonly turn: number;
  /** Past this round the defenders are relieved and win. */
  readonly turnLimit: number;
  readonly activeFaction: Faction;
  readonly status: BattleStatus;
  /** Sorted by id: iteration order is part of determinism. */
  readonly units: readonly UnitState[];
  /** Sorted by id. */
  readonly structures: readonly StructureState[];
  /** Sorted by id. */
  readonly works: readonly WorkState[];
  /** Sorted by tower id. */
  readonly docks: readonly DockState[];
  readonly wind: WindState;
  /** Weather of the battle, and the hour of its first round (it advances each round). */
  readonly weather: Weather;
  readonly startHour: number;
  /** Sorted by cell. */
  readonly fires: readonly FireState[];
  /** Cells that burnt out (they never catch again), sorted. */
  readonly burnt: readonly number[];
  readonly rng: RngState;
}

export interface UnitSpawn {
  readonly id: string;
  readonly typeKey: string;
  readonly position: Vec2;
  readonly facing?: Vec2;
}

export interface Scenario {
  readonly units: readonly UnitSpawn[];
  readonly firstFaction?: Faction;
  readonly initialMorale?: number;
  /** Rounds the defenders must hold (rules.battle.turnLimit when absent). */
  readonly turnLimit?: number;
  /** Fixed weather and start hour (drawn from the seed when absent). */
  readonly weather?: Weather;
  readonly startHour?: number;
}
