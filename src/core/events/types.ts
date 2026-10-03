import type { Command, CommandRejection } from '../commands/types.ts';
import type { Vec2 } from '../math/vec2.ts';
import type { StructureKind } from '../battle/structures.ts';
import type { BattleStatus } from '../battle/types.ts';
import type { Faction } from '../rules/types.ts';

/**
 * Facts emitted by the core. The renderer plays them through its sequenced animation queue;
 * the core never waits for the renderer.
 */
export type GameEvent =
  | UnitMovedEvent
  | UnitAttackedEvent
  | UnitDiedEvent
  | MoraleChangedEvent
  | OverwatchSetEvent
  | StructureDamagedEvent
  | StructureBrokenEvent
  | SiegeWorkProgressedEvent
  | MoatFilledEvent
  | TowerDockedEvent
  | TowerUndockedEvent
  | UnitClimbedEvent
  | FireArrowShotEvent
  | FireStartedEvent
  | FireOutEvent
  | UnitBurnedEvent
  | StructureBurnedEvent
  | BattleEndedEvent
  | TurnEndedEvent
  | TurnStartedEvent
  | CommandRejectedEvent
  | AbilityUsedEvent;

export interface UnitMovedEvent {
  readonly type: 'unitMoved';
  readonly unitId: string;
  /** Smoothed polyline from the start position to the destination (world metres). */
  readonly path: readonly Vec2[];
  /** Exact AP cost of the path (fractional). */
  readonly apCost: number;
  /** Whole AP deducted (ceil of the cost). */
  readonly apSpent: number;
  /** A routed unit running from the enemy on its own (morale below fleeBelow). */
  readonly fleeing?: boolean;
}

/** One blow: an attack, or the riposte it drew. */
export interface UnitAttackedEvent {
  readonly type: 'unitAttacked';
  readonly attackerId: string;
  readonly targetId: string;
  readonly riposte: boolean;
  /** A reaction shot from overwatch, fired mid-move. */
  readonly reaction?: boolean;
  /** The odds that were rolled (shown in the preview). */
  readonly hitChance: number;
  readonly hit: boolean;
  readonly crit: boolean;
  readonly damage: number;
  readonly hpAfter: number;
}

export interface UnitDiedEvent {
  readonly type: 'unitDied';
  readonly unitId: string;
  readonly byId: string;
}

/** A siege engine's blow against a structure. */
export interface StructureDamagedEvent {
  readonly type: 'structureDamaged';
  readonly attackerId: string;
  readonly structureId: string;
  readonly hitChance: number;
  readonly hit: boolean;
  readonly crit: boolean;
  readonly damage: number;
  readonly hpAfter: number;
}

/** A unit thrown down by a collapsing wall-walk. */
export interface FallenUnit {
  readonly unitId: string;
  readonly damage: number;
  readonly hpAfter: number;
}

/** A wall segment collapses into rubble, a gate or portcullis gives way, a drawbridge drops. */
export interface StructureBrokenEvent {
  readonly type: 'structureBroken';
  readonly structureId: string;
  readonly kind: StructureKind;
  /** The engine that dealt the last blow (none for a drawbridge lowered by its operator's death). */
  readonly byId: string | null;
  readonly fallen: readonly FallenUnit[];
}

/** A sapper's turn of work on a site (moat slot or wall segment). */
export interface SiegeWorkProgressedEvent {
  readonly type: 'siegeWorkProgressed';
  readonly unitId: string;
  readonly workId: string;
  readonly kind: 'fill' | 'mine';
  readonly progress: number;
  readonly required: number;
}

/** A moat slot is filled: the causeway can be crossed. */
export interface MoatFilledEvent {
  readonly type: 'moatFilled';
  readonly workId: string;
  readonly byId: string;
}

/** A siege tower has lowered its gangway onto a wall-walk. */
export interface TowerDockedEvent {
  readonly type: 'towerDocked';
  readonly towerId: string;
  readonly structureId: string;
}

/** A docked tower lost its wall (segment down) or was destroyed. */
export interface TowerUndockedEvent {
  readonly type: 'towerUndocked';
  readonly towerId: string;
}

/** A unit climbed a docked tower onto the wall-walk. */
export interface UnitClimbedEvent {
  readonly type: 'unitClimbed';
  readonly unitId: string;
  readonly towerId: string;
  readonly from: Vec2;
  readonly to: Vec2;
}

/** A fire arrow: whether it caught (rolled at `hitChance`). */
export interface FireArrowShotEvent {
  readonly type: 'fireArrowShot';
  readonly unitId: string;
  readonly at: Vec2;
  readonly hitChance: number;
  readonly caught: boolean;
}

/** Cells catching fire (an arrow, or the fire spreading). */
export interface FireStartedEvent {
  readonly type: 'fireStarted';
  readonly cells: readonly number[];
}

/** Fires going out: put out by a unit, or burnt out (`byId` null). */
export interface FireOutEvent {
  readonly type: 'fireOut';
  readonly cells: readonly number[];
  readonly byId: string | null;
}

export interface UnitBurnedEvent {
  readonly type: 'unitBurned';
  readonly unitId: string;
  readonly damage: number;
  readonly hpAfter: number;
}

/** A wooden gate eaten by fire. */
export interface StructureBurnedEvent {
  readonly type: 'structureBurned';
  readonly structureId: string;
  readonly damage: number;
  readonly hpAfter: number;
}

export interface OverwatchSetEvent {
  readonly type: 'overwatchSet';
  readonly unitId: string;
  readonly direction: Vec2;
}

export type MoraleReason = 'allyDied' | 'wounded' | 'kill' | 'recovery' | 'wallCollapsed' | 'fire' | 'rally';

export interface MoraleChangedEvent {
  readonly type: 'moraleChanged';
  readonly unitId: string;
  /** Morale after the change. */
  readonly morale: number;
  readonly delta: number;
  readonly reason: MoraleReason;
}

/** How a battle ended: a side wiped out, a side routed, or the defenders relieved (turn limit). */
export type BattleEndReason = 'eliminated' | 'routed' | 'relieved';

export interface BattleEndedEvent {
  readonly type: 'battleEnded';
  readonly status: Exclude<BattleStatus, 'ongoing'>;
  readonly reason: BattleEndReason;
}

export interface TurnEndedEvent {
  readonly type: 'turnEnded';
  readonly faction: Faction;
  readonly turn: number;
}

export interface TurnStartedEvent {
  readonly type: 'turnStarted';
  readonly faction: Faction;
  readonly turn: number;
}

export interface CommandRejectedEvent {
  readonly type: 'commandRejected';
  readonly command: Command;
  readonly reason: CommandRejection;
}

/** A hero used an ability (J5): `affected` are the units it touched (buffed, rallied, struck). */
export interface AbilityUsedEvent {
  readonly type: 'abilityUsed';
  readonly unitId: string;
  readonly abilityId: string;
  readonly affected: readonly string[];
}
