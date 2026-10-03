/**
 * The garrison's AI off the main thread (J5): a turn takes 0.1–0.6 s of planning, which froze
 * the picture. The worker builds the same battle context as the session from the map, plans the
 * turn with the same deterministic core (playTurn), and sends back its commands; the session
 * replays them on its own state, so the result, the log and the replay are unchanged.
 */
import { playTurn } from '../../core/ai/planner.ts';
import { groundOf, lightsOf } from '../../core/battle/conditions.ts';
import { createBattleContext, type BattleContext } from '../../core/battle/context.ts';
import { moatsOf } from '../../core/battle/moat.ts';
import { planStructures, setGround } from '../../core/battle/structures.ts';
import type { BattleState } from '../../core/battle/types.ts';
import type { Command } from '../../core/commands/types.ts';
import type { Faction } from '../../core/rules/types.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';

export type AiRequest = { readonly type: 'init'; readonly layout: WorldLayout } | { readonly type: 'plan'; readonly id: number; readonly state: BattleState; readonly faction: Faction };

export type AiResponse = { readonly id: number; readonly ok: true; readonly commands: readonly Command[]; readonly ms: number } | { readonly id: number; readonly ok: false; readonly error: string };

// The app tsconfig types `self` as a Window; this file runs in a dedicated worker.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AiRequest>) => void) | null;
  postMessage(message: AiResponse): void;
};

let ctx: BattleContext | null = null;

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'init') {
    const layout = request.layout;
    ctx = createBattleContext(layout.terrain, DEFAULT_RULES, layout.deck, planStructures(layout, DEFAULT_RULES.structures), moatsOf(layout), lightsOf(layout));
    return;
  }
  try {
    if (!ctx) throw new Error('AI worker: plan before init');
    const start = performance.now();
    // The ground under the battle's weather (mud in the rain), as createBattle set it in the session.
    setGround(ctx, groundOf(request.state.weather));
    const turn = playTurn(ctx, request.state, request.faction);
    scope.postMessage({ id: request.id, ok: true, commands: turn.commands, ms: performance.now() - start });
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
