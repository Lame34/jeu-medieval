/**
 * Pure command reducer: (state, command) → (new state, events). Invalid commands leave the
 * state untouched and emit a `commandRejected` event, so a recorded command log always replays.
 * The context's navigation grid is synced to the state's structures before and after each
 * command (a breach or a lowered drawbridge reshapes the ground).
 */
import { previewAttack, resolveAttack } from '../battle/combat.ts';
import { expireBuffs, previewAbility, resolveAbility } from '../battle/heroes.ts';
import { moraleStanding, startTurn } from '../battle/morale.ts';
import { canOverwatch, moveThroughOverwatch } from '../battle/overwatch.ts';
import type { BattleContext } from '../battle/context.ts';
import { findUnit, planMove, type MovePlan } from '../battle/movement.ts';
import { lowerDrawbridges, previewStructureAttack, resolveStructureAttack } from '../battle/siege.ts';
import { previewFill, previewUndermine, resolveWork, type WorkPreviewResult } from '../battle/siege-works.ts';
import { previewClimb, previewDock, refillDocks, releaseDocks, resolveClimb, resolveDock } from '../battle/siege-tower.ts';
import { fireRound, previewExtinguish, previewFireArrow, resolveExtinguish, resolveFireArrow } from '../battle/fire.ts';
import { syncNav } from '../battle/structures.ts';
import { previewSummons, resolveSummons } from '../battle/summons.ts';
import type { BattleState, UnitState } from '../battle/types.ts';
import type { GameEvent } from '../events/types.ts';
import { normalize } from '../math/vec2.ts';
import type { Faction } from '../rules/types.ts';
import type {
  AttackCommand,
  AttackStructureCommand,
  ClimbTowerCommand,
  Command,
  CommandRejection,
  DockTowerCommand,
  EndTurnCommand,
  ExtinguishCommand,
  FillMoatCommand,
  FireArrowCommand,
  MoveCommand,
  OverwatchCommand,
  UndermineCommand,
  AbilityCommand,
} from './types.ts';

export interface CommandResult {
  readonly state: BattleState;
  readonly events: readonly GameEvent[];
  readonly rejection: CommandRejection | null;
}

const FACTION_ORDER: readonly Faction[] = ['attacker', 'defender'];

function reject(state: BattleState, command: Command, reason: CommandRejection): CommandResult {
  return { state, events: [{ type: 'commandRejected', command, reason }], rejection: reason };
}

function replaceUnit(state: BattleState, updated: UnitState): BattleState {
  return { ...state, units: state.units.map((u) => (u.id === updated.id ? updated : u)) };
}

function applyMove(ctx: BattleContext, state: BattleState, command: MoveCommand): CommandResult {
  const unit = findUnit(state, command.unitId);
  if (!unit) return reject(state, command, 'unknownUnit');
  if (!unit.alive) return reject(state, command, 'unitDead');
  if (unit.faction !== state.activeFaction) return reject(state, command, 'notYourTurn');
  if (moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return reject(state, command, 'unitFleeing');
  const result = planMove(ctx, state, command.unitId, command.to);
  if (!result.ok) return reject(state, command, result.reason);
  const plan: MovePlan = result.plan;
  // Through the enemy's overwatch cones: reaction shots cut the move into segments.
  const moved = moveThroughOverwatch(ctx, state, unit, plan);
  return { state: moved.state, events: moved.events, rejection: null };
}

function applyOverwatch(ctx: BattleContext, state: BattleState, command: OverwatchCommand): CommandResult {
  const unit = findUnit(state, command.unitId);
  if (!unit) return reject(state, command, 'unknownUnit');
  if (!unit.alive) return reject(state, command, 'unitDead');
  if (unit.faction !== state.activeFaction) return reject(state, command, 'notYourTurn');
  if (moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return reject(state, command, 'unitFleeing');
  if (!canOverwatch(ctx, unit)) return reject(state, command, 'cannotOverwatch');
  if (unit.actions <= 0) return reject(state, command, 'noActionLeft');
  if (unit.ap < ctx.rules.damage.attackApCost) return reject(state, command, 'insufficientAp');
  const direction = normalize(command.direction);
  if (direction.x === 0 && direction.z === 0) return reject(state, command, 'invalidDirection');
  const guarded: UnitState = { ...unit, overwatch: direction, facing: direction, ap: 0, actions: 0 };
  return { state: replaceUnit(state, guarded), events: [{ type: 'overwatchSet', unitId: unit.id, direction }], rejection: null };
}

function applyAttack(ctx: BattleContext, state: BattleState, command: AttackCommand): CommandResult {
  const attacker = findUnit(state, command.unitId);
  if (attacker?.alive && attacker.faction === state.activeFaction && moraleStanding(ctx.rules.morale, attacker.morale) === 'fleeing') {
    return reject(state, command, 'unitFleeing');
  }
  const result = previewAttack(ctx, state, command.unitId, command.targetId);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveAttack(ctx, state, result.preview);
  return { state: next, events, rejection: null };
}

function applyAttackStructure(ctx: BattleContext, state: BattleState, command: AttackStructureCommand): CommandResult {
  const attacker = findUnit(state, command.unitId);
  if (attacker?.alive && attacker.faction === state.activeFaction && moraleStanding(ctx.rules.morale, attacker.morale) === 'fleeing') {
    return reject(state, command, 'unitFleeing');
  }
  const result = previewStructureAttack(ctx, state, command.unitId, command.structureId);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveStructureAttack(ctx, state, result.preview);
  return { state: next, events, rejection: null };
}

function applyWork(ctx: BattleContext, state: BattleState, command: FillMoatCommand | UndermineCommand): CommandResult {
  const unit = findUnit(state, command.unitId);
  if (unit?.alive && unit.faction === state.activeFaction && moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return reject(state, command, 'unitFleeing');
  const result: WorkPreviewResult = command.type === 'fillMoat' ? previewFill(ctx, state, command.unitId, command.at) : previewUndermine(ctx, state, command.unitId, command.structureId);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveWork(ctx, state, result.preview);
  return { state: next, events, rejection: null };
}

function applyDock(ctx: BattleContext, state: BattleState, command: DockTowerCommand): CommandResult {
  const result = previewDock(ctx, state, command.unitId, command.structureId);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveDock(ctx, state, result.preview);
  return { state: next, events, rejection: null };
}

function applyClimb(ctx: BattleContext, state: BattleState, command: ClimbTowerCommand): CommandResult {
  const unit = findUnit(state, command.unitId);
  if (unit?.alive && unit.faction === state.activeFaction && moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return reject(state, command, 'unitFleeing');
  const result = previewClimb(ctx, state, command.unitId, command.towerId);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveClimb(ctx, state, result.preview);
  return { state: next, events, rejection: null };
}

function applyFireArrow(ctx: BattleContext, state: BattleState, command: FireArrowCommand): CommandResult {
  const unit = findUnit(state, command.unitId);
  if (unit?.alive && unit.faction === state.activeFaction && moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return reject(state, command, 'unitFleeing');
  const result = previewFireArrow(ctx, state, command.unitId, command.at);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveFireArrow(ctx, state, result.preview);
  return { state: next, events, rejection: null };
}

function applyExtinguish(ctx: BattleContext, state: BattleState, command: ExtinguishCommand): CommandResult {
  const unit = findUnit(state, command.unitId);
  if (unit?.alive && unit.faction === state.activeFaction && moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return reject(state, command, 'unitFleeing');
  const result = previewExtinguish(ctx, state, command.unitId, command.at);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveExtinguish(ctx, state, command.unitId, result.cells);
  return { state: next, events, rejection: null };
}

function applyEndTurn(ctx: BattleContext, ended: BattleState, _command: EndTurnCommand): CommandResult {
  // The side's buffs (a volley, a calibration) last until the end of its turn.
  const state = expireBuffs(ended, ended.activeFaction);
  const index = FACTION_ORDER.indexOf(state.activeFaction);
  const next = FACTION_ORDER[(index + 1) % FACTION_ORDER.length] as Faction;
  const turn = next === FACTION_ORDER[0] ? state.turn + 1 : state.turn;
  const events: GameEvent[] = [
    { type: 'turnEnded', faction: state.activeFaction, turn: state.turn },
    { type: 'turnStarted', faction: next, turn },
  ];
  // Recovery, AP and attacks restored (shaken penalty), routed units run.
  // Past the turn limit the defenders are relieved.
  if (turn > state.turnLimit) {
    events.push({ type: 'battleEnded', status: 'defenderWon', reason: 'relieved' });
    return { state: { ...state, activeFaction: next, turn, status: 'defenderWon' }, events, rejection: null };
  }
  // A new round: the fires burn and spread before the attackers move again.
  const burnt = next === FACTION_ORDER[0] ? fireRound(ctx, { ...state, activeFaction: next, turn }, events) : { ...state, activeFaction: next, turn };
  if (burnt.status !== 'ongoing') return { state: burnt, events, rejection: null };
  const started = startTurn(ctx, refillDocks(burnt), next, events);
  // A side whose every survivor is fleeing has lost.
  const standing = started.units.filter((u) => u.alive && u.faction === next);
  if (standing.length > 0 && standing.every((u) => moraleStanding(ctx.rules.morale, u.morale) === 'fleeing')) {
    const status = next === 'attacker' ? 'defenderWon' : 'attackerWon';
    events.push({ type: 'battleEnded', status, reason: 'routed' });
    return { state: { ...started, status }, events, rejection: null };
  }
  return { state: started, events, rejection: null };
}

function dispatch(ctx: BattleContext, state: BattleState, command: Command): CommandResult {
  switch (command.type) {
    case 'move':
      return applyMove(ctx, state, command);
    case 'attack':
      return applyAttack(ctx, state, command);
    case 'attackStructure':
      return applyAttackStructure(ctx, state, command);
    case 'fillMoat':
    case 'undermine':
      return applyWork(ctx, state, command);
    case 'dockTower':
      return applyDock(ctx, state, command);
    case 'fireArrow':
      return applyFireArrow(ctx, state, command);
    case 'extinguish':
      return applyExtinguish(ctx, state, command);
    case 'climbTower':
      return applyClimb(ctx, state, command);
    case 'overwatch':
      return applyOverwatch(ctx, state, command);
    case 'ability':
      return applyAbility(ctx, state, command);
    case 'summon': {
      const result = previewSummons(ctx, state);
      if (!result.ok) return reject(state, command, result.reason);
      const { state: next, events } = resolveSummons(state, result.preview);
      return { state: next, events, rejection: null };
    }
    case 'endTurn':
      return applyEndTurn(ctx, state, command);
  }
}

function applyAbility(ctx: BattleContext, state: BattleState, command: AbilityCommand): CommandResult {
  const unit = findUnit(state, command.unitId);
  if (unit?.alive && unit.faction === state.activeFaction && moraleStanding(ctx.rules.morale, unit.morale) === 'fleeing') return reject(state, command, 'unitFleeing');
  const result = previewAbility(ctx, state, command);
  if (!result.ok) return reject(state, command, result.reason);
  const { state: next, events } = resolveAbility(ctx, state, result.preview);
  return { state: next, events, rejection: null };
}

export function applyCommand(ctx: BattleContext, state: BattleState, command: Command): CommandResult {
  if (state.status !== 'ongoing') return reject(state, command, 'battleOver');
  syncNav(ctx, state.structures, state.works);
  const result = dispatch(ctx, state, command);
  if (result.rejection || result.state.status !== 'ongoing') {
    syncNav(ctx, result.state.structures, result.state.works);
    return result;
  }
  // Deaths, whatever caused them, may have freed a drawbridge.
  const events = [...result.events];
  const settled = releaseDocks(lowerDrawbridges(ctx, result.state, events), events);
  syncNav(ctx, settled.structures, settled.works);
  return settled === result.state ? result : { state: settled, events, rejection: null };
}
