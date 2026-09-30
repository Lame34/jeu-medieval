import type { Vec2 } from '../math/vec2.ts';

/** Player / AI intentions. Plain JSON: a battle replays from `seed + scenario + Command[]`. */
export type Command = MoveCommand | AttackCommand | OverwatchCommand | EndTurnCommand;

export interface MoveCommand {
  readonly type: 'move';
  readonly unitId: string;
  /** World position; snapped to the containing cell's centre. */
  readonly to: Vec2;
}

export interface AttackCommand {
  readonly type: 'attack';
  readonly unitId: string;
  readonly targetId: string;
}

/** Gives up the unit's action (and remaining AP) to watch a cone until its next turn. */
export interface OverwatchCommand {
  readonly type: 'overwatch';
  readonly unitId: string;
  /** Cone direction on the ground plane (any length). */
  readonly direction: Vec2;
}

export interface EndTurnCommand {
  readonly type: 'endTurn';
}

export const COMMAND_REJECTIONS = [
  'battleOver',
  'unknownUnit',
  'unitDead',
  'notYourTurn',
  'outOfBounds',
  'sameCell',
  'destinationOccupied',
  'noPath',
  'insufficientAp',
  'unknownTarget',
  'targetDead',
  'targetFriendly',
  'noAttack',
  'noActionLeft',
  'outOfRange',
  'noLineOfSight',
  'unitFleeing',
  'cannotOverwatch',
  'invalidDirection',
] as const;

export type CommandRejection = (typeof COMMAND_REJECTIONS)[number];
