import type { Vec2 } from '../math/vec2.ts';

/** Player / AI intentions. Plain JSON: a battle replays from `seed + scenario + Command[]`. */
export type Command = MoveCommand | AttackCommand | EndTurnCommand;

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
] as const;

export type CommandRejection = (typeof COMMAND_REJECTIONS)[number];
