/**
 * The summons (ADR-047): before the assault and as it goes on, the attackers' herald calls on the
 * garrison to yield the place. The more it has lost, men and walls, the readier it is to treat;
 * its captain, while he stands, holds it to its duty; a captain who swore never to yield (a
 * castle's `sworn`) does not treat at all. Accepted, the garrison marches out with its lives
 * and the castle is taken; refused, the herald may come back a few rounds later. The die is the
 * battle's own: a replay is exact.
 */
import type { CommandRejection } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import type { GameRules } from '../rules/types.ts';
import { Rng } from '../rng.ts';
import { garrisonStrength } from './combat.ts';
import type { BattleContext } from './context.ts';
import { isBroken } from './structures.ts';
import { COMMAND_TAG } from './tags.ts';
import type { BattleState } from './types.ts';

export interface SummonsPreview {
  /** The chance that the garrison yields. */
  readonly chance: number;
  /** Its captain stands (the chance is cut down). */
  readonly captainStands: boolean;
  /** Its captain swore never to yield, and stands (no chance at all). */
  readonly sworn: boolean;
}

export type SummonsPreviewResult = { readonly ok: true; readonly preview: SummonsPreview } | { readonly ok: false; readonly reason: CommandRejection };

/** Rounds before the herald may come back (0: he may go now). */
export function summonsWait(rules: Pick<GameRules, 'battle'>, state: BattleState): number {
  if (!state.summons) return 0;
  return Math.max(0, state.summons.lastTurn + rules.battle.summons.cooldownRounds - state.turn);
}

/** Breaches that weigh on the garrison: walls down, the gate, the portcullis. */
function breaches(ctx: BattleContext, state: BattleState): number {
  return ctx.structures.filter((d) => d.kind !== 'drawbridge' && isBroken(state.structures, d.id)).length;
}

export function previewSummons(ctx: BattleContext, state: BattleState): SummonsPreviewResult {
  if (state.activeFaction !== 'attacker') return { ok: false, reason: 'notYourTurn' };
  if (summonsWait(ctx.rules, state) > 0) return { ok: false, reason: 'summonsTooSoon' };
  const s = ctx.rules.battle.summons;
  const garrison = garrisonStrength(ctx.rules, state.units);
  const captainStands = state.units.some((u) => u.alive && u.faction === 'defender' && ctx.rules.units[u.typeKey]?.tags.includes(COMMAND_TAG));
  const sworn = captainStands && state.sworn === true;
  const lost = garrison.men > 0 ? 1 - garrison.standing / garrison.men : 0;
  const raw = s.base + s.perLostShare * lost + s.perBreach * Math.min(breaches(ctx, state), s.maxBreaches);
  const chance = sworn ? 0 : Math.min(s.max, raw * (captainStands ? s.captainFactor : 1));
  return { ok: true, preview: { chance, captainStands, sworn } };
}

export function resolveSummons(state: BattleState, preview: SummonsPreview): { state: BattleState; events: GameEvent[] } {
  const rng = Rng.fromState(state.rng);
  const accepted = rng.next() < preview.chance;
  const events: GameEvent[] = [{ type: 'garrisonSummoned', chance: preview.chance, accepted }];
  if (accepted) events.push({ type: 'battleEnded', status: 'attackerWon', reason: 'surrendered' });
  return {
    state: { ...state, summons: { lastTurn: state.turn, accepted }, ...(accepted ? { status: 'attackerWon' as const } : {}), rng: rng.getState() },
    events,
  };
}
