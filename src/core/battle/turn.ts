/**
 * Who can still do something this turn (J7): the end-of-turn warning and the key to the next man
 * follow the rules. Every step and every deed costs points of action (the rules' tests hold this);
 * a beffroi accolé au mur moves no more and has no deed of its own; a man in flight obeys no more.
 */
import type { BattleContext } from './context.ts';
import { moraleStanding } from './morale.ts';
import { dockOf } from './siege-tower.ts';
import type { BattleState, UnitState } from './types.ts';

export function canStillAct(ctx: BattleContext, state: BattleState, unit: UnitState): boolean {
  return unit.alive && unit.faction === state.activeFaction && unit.ap > 0 && moraleStanding(ctx.rules.morale, unit.morale) !== 'fleeing' && dockOf(state, unit.id) === undefined;
}
