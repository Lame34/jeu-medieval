/**
 * Pure command reducer: (state, command) → (new state, events). Invalid commands leave the
 * state untouched and emit a `commandRejected` event, so a recorded command log always replays.
 */
import { previewAttack, resolveAttack } from '../battle/combat.ts';
import { moraleStanding, startTurn } from '../battle/morale.ts';
import type { BattleContext } from '../battle/context.ts';
import { findUnit, planMove, type MovePlan } from '../battle/movement.ts';
import type { BattleState, UnitState } from '../battle/types.ts';
import type { GameEvent } from '../events/types.ts';
import { normalize, sub, type Vec2 } from '../math/vec2.ts';
import type { Faction } from '../rules/types.ts';
import type { AttackCommand, Command, CommandRejection, EndTurnCommand, MoveCommand } from './types.ts';

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

function facingAlong(path: readonly Vec2[], fallback: Vec2): Vec2 {
  const last = path[path.length - 1];
  const beforeLast = path[path.length - 2];
  if (!last || !beforeLast) return fallback;
  const dir = normalize(sub(last, beforeLast));
  return dir.x === 0 && dir.z === 0 ? fallback : dir;
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
  const moved: UnitState = {
    ...unit,
    position: plan.destination,
    facing: facingAlong(plan.path, unit.facing),
    ap: unit.ap - plan.apSpent,
  };
  return {
    state: replaceUnit(state, moved),
    events: [{ type: 'unitMoved', unitId: unit.id, path: plan.path, apCost: plan.apCost, apSpent: plan.apSpent }],
    rejection: null,
  };
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
    case 'endTurn':
      return applyEndTurn(ctx, state, command);
  }
}
