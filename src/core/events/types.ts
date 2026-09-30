import type { Command, CommandRejection } from '../commands/types.ts';
import type { Vec2 } from '../math/vec2.ts';
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
  | BattleEndedEvent
  | TurnEndedEvent
  | TurnStartedEvent
  | CommandRejectedEvent;

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

export type MoraleReason = 'allyDied' | 'wounded' | 'kill' | 'recovery';

export interface MoraleChangedEvent {
  readonly type: 'moraleChanged';
  readonly unitId: string;
  /** Morale after the change. */
  readonly morale: number;
  readonly delta: number;
  readonly reason: MoraleReason;
}

export interface BattleEndedEvent {
  readonly type: 'battleEnded';
  readonly status: Exclude<BattleStatus, 'ongoing'>;
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
