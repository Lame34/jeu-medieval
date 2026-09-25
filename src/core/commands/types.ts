import type { Vec2 } from '../math/vec2.ts';

/** Player / AI intentions. Plain JSON: a battle replays from `seed + scenario + Command[]`. */
export type Command = MoveCommand | EndTurnCommand;

export interface MoveCommand {
  readonly type: 'move';
  readonly unitId: string;
  /** World position; snapped to the containing cell's centre. */
  readonly to: Vec2;
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
] as const;

export type CommandRejection = (typeof COMMAND_REJECTIONS)[number];
