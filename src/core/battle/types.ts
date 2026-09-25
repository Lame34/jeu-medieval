import type { Vec2 } from '../math/vec2.ts';
import type { RngState } from '../rng.ts';
import type { Faction } from '../rules/types.ts';

export const BATTLE_STATE_VERSION = 1;

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
  readonly morale: number;
  readonly alive: boolean;
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
