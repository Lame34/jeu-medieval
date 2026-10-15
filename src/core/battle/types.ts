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
  /** A side's skill at arms, from the scenario (absent: none). */
  readonly aim?: Readonly<Partial<Record<Faction, number>>>;
  /** The garrison's captain swore never to yield (the summons, ADR-047). */
  readonly sworn?: true;
  /** The herald's last summons: when, and whether the garrison yielded. */
  readonly summons?: { readonly lastTurn: number; readonly accepted: boolean };
  /** Men who went up a beffroi onto the walls, over the whole battle (feats of arms, ADR-048). */
  readonly climbed?: number;
  /** Wooden works brought down by fire (a gate, a drawbridge), sorted. */
  readonly burned?: readonly string[];
  readonly rng: RngState;
}

export interface UnitSpawn {
  readonly id: string;
  readonly typeKey: string;
  readonly position: Vec2;
  readonly facing?: Vec2;
}

/** A structure's condition before the first round (a campaign's stratagem: a lowered drawbridge, a mined wall). */
export interface StructureStart {
  readonly id: string;
  /** Remaining HP over maximum, in (0, 1]. */
  readonly hpFraction?: number;
  /** Down from the start (a drawbridge: lowered). */
  readonly broken?: boolean;
}

export interface Scenario {
  readonly units: readonly UnitSpawn[];
  readonly firstFaction?: Faction;
  readonly initialMorale?: number;
  /** Starting morale by side (over initialMorale). */
  readonly morale?: Readonly<Partial<Record<Faction, number>>>;
  /** Structures damaged or down before the battle (intact otherwise). */
  readonly structures?: readonly StructureStart[];
  /** Moat fill sites already crossed by a fascine causeway. */
  readonly filled?: readonly string[];
  /** Rounds the defenders must hold (rules.battle.turnLimit when absent). */
  readonly turnLimit?: number;
  /** Fixed weather and start hour (drawn from the seed when absent). */
  readonly weather?: Weather;
  readonly startHour?: number;
  /** A side's skill at arms (the player's rank, ADR-045): added to the hit chance of its men's blows and shots. */
  readonly aim?: Readonly<Partial<Record<Faction, number>>>;
  /** The garrison's captain swore never to yield to a summons. */
  readonly sworn?: boolean;
}
