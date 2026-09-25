import { applyCommand } from '../commands/apply.ts';
import type { Command } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import { hashValue } from '../math/hash.ts';
import type { Seed } from '../rng.ts';
import type { BattleContext } from './context.ts';
import { createBattle } from './create.ts';
import type { BattleState, Scenario } from './types.ts';

export interface ReplayResult {
  readonly state: BattleState;
  readonly events: readonly GameEvent[];
}

/** Rebuilds a battle from its seed, scenario and command log. */
export function replay(ctx: BattleContext, seed: Seed, scenario: Scenario, commands: readonly Command[]): ReplayResult {
  let state = createBattle(ctx, seed, scenario);
  const events: GameEvent[] = [];
  for (const command of commands) {
    const result = applyCommand(ctx, state, command);
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/** Stable 64-bit digest of a battle state (canonical serialisation). */
export function hashBattleState(state: BattleState): string {
  return hashValue(state);
}
