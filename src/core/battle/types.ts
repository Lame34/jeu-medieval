import type { Vec2 } from '../math/vec2.ts';
import type { RngState } from '../rng.ts';
import type { Faction } from '../rules/types.ts';

/** 5: siege-tower docks. 4: sappers' works. 3: castle structures (J4). 2: units carry the attacks left this turn (J3 combat). */
export const BATTLE_STATE_VERSION = 5;

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

/** Fully serialisable battle state. A battle is `seed + scenario + commands`. */
export interface BattleState {
  readonly version: typeof BATTLE_STATE_VERSION;
  readonly seedKey: number;
  readonly turn: number;
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
}
