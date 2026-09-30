/**
 * Pure command reducer: (state, command) → (new state, events). Invalid commands leave the
 * state untouched and emit a `commandRejected` event, so a recorded command log always replays.
 */
import { previewAttack, resolveAttack } from '../battle/combat.ts';
import { moraleStanding, startTurn } from '../battle/morale.ts';
import { canOverwatch, moveThroughOverwatch } from '../battle/overwatch.ts';
import type { BattleContext } from '../battle/context.ts';
import { findUnit, planMove, type MovePlan } from '../battle/movement.ts';
import type { BattleState, UnitState } from '../battle/types.ts';
import type { GameEvent } from '../events/types.ts';
import { normalize } from '../math/vec2.ts';
import type { Faction } from '../rules/types.ts';
import type { AttackCommand, Command, CommandRejection, EndTurnCommand, MoveCommand, OverwatchCommand } from './types.ts';

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

function applyEndTurn(ctx: BattleContext, state: BattleState, _command: EndTurnCommand): CommandResult {
  const index = FACTION_ORDER.indexOf(state.activeFaction);
  const next = FACTION_ORDER[(index + 1) % FACTION_ORDER.length] as Faction;
  const turn = next === FACTION_ORDER[0] ? state.turn + 1 : state.turn;
  const events: GameEvent[] = [
    { type: 'turnEnded', faction: state.activeFaction, turn: state.turn },
    { type: 'turnStarted', faction: next, turn },
  ];
  // Recovery, AP and attacks restored (shaken penalty), routed units run.
  const started = startTurn(ctx, { ...state, activeFaction: next, turn }, next, events);
  return { state: started, events, rejection: null };
}

export function applyCommand(ctx: BattleContext, state: BattleState, command: Command): CommandResult {
  if (state.status !== 'ongoing') return reject(state, command, 'battleOver');
  switch (command.type) {
    case 'move':
      return applyMove(ctx, state, command);
    case 'attack':
      return applyAttack(ctx, state, command);
    case 'overwatch':
      return applyOverwatch(ctx, state, command);
    case 'endTurn':
      return applyEndTurn(ctx, state, command);
  }
}
