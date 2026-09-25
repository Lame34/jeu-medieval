import type { Command, CommandRejection } from '../commands/types.ts';
import type { Vec2 } from '../math/vec2.ts';
import type { Faction } from '../rules/types.ts';

/**
 * Facts emitted by the core. The renderer plays them through its sequenced animation queue;
 * the core never waits for the renderer.
 */
export type GameEvent = UnitMovedEvent | TurnEndedEvent | TurnStartedEvent | CommandRejectedEvent;

export interface UnitMovedEvent {
  readonly type: 'unitMoved';
  readonly unitId: string;
  /** Smoothed polyline from the start position to the destination (world metres). */
  readonly path: readonly Vec2[];
  /** Exact AP cost of the path (fractional). */
  readonly apCost: number;
  /** Whole AP deducted (ceil of the cost). */
  readonly apSpent: number;
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
