import type { Vec2 } from '../math/vec2.ts';

/** Player / AI intentions. Plain JSON: a battle replays from `seed + scenario + Command[]`. */
export type Command =
  | MoveCommand
  | AttackCommand
  | AttackStructureCommand
  | FillMoatCommand
  | UndermineCommand
  | DockTowerCommand
  | ClimbTowerCommand
  | OverwatchCommand
  | EndTurnCommand;

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

/** A siege engine strikes a castle structure (wall segment, gate, portcullis). */
export interface AttackStructureCommand {
  readonly type: 'attackStructure';
  readonly unitId: string;
  readonly structureId: string;
}

/** A sapper spends its turn filling the moat slot under `at` with fascines. */
export interface FillMoatCommand {
  readonly type: 'fillMoat';
  readonly unitId: string;
  readonly at: Vec2;
}

/** A sapper spends its turn undermining a curtain segment from its foot. */
export interface UndermineCommand {
  readonly type: 'undermine';
  readonly unitId: string;
  readonly structureId: string;
}

/** A siege tower docks against a curtain segment, lowering its gangway. */
export interface DockTowerCommand {
  readonly type: 'dockTower';
  readonly unitId: string;
  readonly structureId: string;
}

/** A unit at a docked tower's foot climbs it onto the wall-walk. */
export interface ClimbTowerCommand {
  readonly type: 'climbTower';
  readonly unitId: string;
  readonly towerId: string;
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
  'unknownStructure',
  'structureDown',
  'structureInvulnerable',
  'noSiegeWeapon',
  'gatesOnly',
  'structureShielded',
  'noSiegeSkill',
  'notAMoat',
  'workDone',
  'notAWall',
  'notATower',
  'alreadyDocked',
  'notDocked',
  'towerFull',
  'cannotClimb',
  'noRoomOnWall',
  'towerDocked',
] as const;

export type CommandRejection = (typeof COMMAND_REJECTIONS)[number];
