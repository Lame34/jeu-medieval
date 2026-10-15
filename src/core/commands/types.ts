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
  | FireArrowCommand
  | ExtinguishCommand
  | OverwatchCommand
  | AbilityCommand
  | SummonCommand
  | EndTurnCommand;

/** The herald calls on the garrison to yield (ADR-047): the side to play, no man spent. */
export interface SummonCommand {
  readonly type: 'summon';
}

/** A hero's ability (J5): its target depends on the ability (none, a unit, a work site). */
export interface AbilityCommand {
  readonly type: 'ability';
  readonly unitId: string;
  readonly abilityId: string;
  /** An enemy (piercing shot, charge) or a friendly engine (calibration). */
  readonly targetId?: string;
  /** A moat slot to fill (rushed works)… */
  readonly at?: Vec2;
  /** …or a curtain segment to undermine. */
  readonly structureId?: string;
}

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

/** An archer shoots a fire arrow at the point `at` (+1 AP). */
export interface FireArrowCommand {
  readonly type: 'fireArrow';
  readonly unitId: string;
  readonly at: Vec2;
}

/** A unit beside a fire puts it out (and the fires around it). */
export interface ExtinguishCommand {
  readonly type: 'extinguish';
  readonly unitId: string;
  readonly at: Vec2;
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
  'noFireArrows',
  'alreadyBurning',
  'notFlammable',
  'notBurning',
  'notAHero',
  'unknownAbility',
  'abilityCooling',
  'invalidAbilityTarget',
  'summonsTooSoon',
] as const;

export type CommandRejection = (typeof COMMAND_REJECTIONS)[number];
