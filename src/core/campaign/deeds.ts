/**
 * What a battle won leaves for the chronicle (ADR-050): the facts its chapter is told from, read
 * off the battle's last state — how the garrison gave up, the walls and the gate brought down,
 * the fagots, the mines, the beffroi, the fire, the dead — with what the campaign knew of it (the
 * plan, the rank, the provisions, the wounded, the assault it was).
 */
import type { BattleContext } from '../battle/context.ts';
import { lossReason } from '../battle/combat.ts';
import { FILL_SITE_PREFIX } from '../battle/moat.ts';
import { MINE_SITE_PREFIX } from '../battle/siege-works.ts';
import { isBroken, type StructureKind } from '../battle/structures.ts';
import { COMMAND_TAG } from '../battle/tags.ts';
import type { BattleState } from '../battle/types.ts';
import type { Banners } from './scenario.ts';
import type { Rank } from './types.ts';

/** How a garrison gave the castle up: to the herald, laying down its arms, fleeing, or fallen to the last. */
export const DEED_ENDINGS = ['summoned', 'surrendered', 'routed', 'eliminated'] as const;
export type DeedEnding = (typeof DEED_ENDINGS)[number];

/** What the campaign knew of the battle, beyond its last state. */
export interface DeedsContext {
  /** The plan sealed at the council (a stratagem id), or none. */
  readonly stratagem: string | null;
  readonly rank: Rank;
  /** The provisions bought at the tents. */
  readonly provisions: readonly string[];
  /** Companions gravely wounded. */
  readonly wounded: readonly string[];
  /** Which assault took the castle (1: the first). */
  readonly assault: number;
  /** The banners of this very battle. */
  readonly banners: Banners;
}

export interface BattleDeeds extends DeedsContext {
  readonly ending: DeedEnding;
  readonly turns: number;
  readonly turnLimit: number;
  /** Our men fallen, heroes included. */
  readonly lost: number;
  /** The garrison's men fallen, and how many it had. */
  readonly slain: number;
  readonly garrison: number;
  /** Walls brought down, by the mangonel or by a mine; those that a mine brought down. */
  readonly breaches: number;
  readonly mined: number;
  readonly gate: boolean;
  readonly portcullis: boolean;
  readonly drawbridge: boolean;
  /** The kinds of the wooden works brought down by fire (the gate, the drawbridge), sorted. */
  readonly burned: readonly StructureKind[];
  /** Stretches of moat filled with fagots. */
  readonly filled: number;
  /** Men gone up a beffroi onto the walls. */
  readonly climbed: number;
  /** The garrison's captain still alive at the end. */
  readonly captain: boolean;
}

/** The deeds of a battle that ended in `state`, taken; null for one lost or still going on. */
export function deedsOf(ctx: Pick<BattleContext, 'rules' | 'structures'>, state: BattleState, known: DeedsContext): BattleDeeds | null {
  if (state.status !== 'attackerWon') return null;
  const down = (kind: string) => ctx.structures.filter((d) => d.kind === kind && isBroken(state.structures, d.id)).length;
  const defenders = state.units.filter((u) => u.faction === 'defender');
  const done = (prefix: string) => state.works.filter((w) => w.done && w.id.startsWith(prefix)).length;
  return {
    ...known,
    ending: state.summons?.accepted === true ? 'summoned' : lossReason(ctx.rules, state.units, 'attackerWon'),
    turns: state.turn,
    turnLimit: state.turnLimit,
    lost: state.units.filter((u) => u.faction === 'attacker' && !u.alive).length,
    slain: defenders.filter((u) => !u.alive).length,
    garrison: defenders.length,
    breaches: down('wall'),
    mined: done(MINE_SITE_PREFIX),
    gate: down('gate') > 0,
    portcullis: down('portcullis') > 0,
    drawbridge: down('drawbridge') > 0,
    burned: [...new Set((state.burned ?? []).map((id) => ctx.structures.find((d) => d.id === id)?.kind).filter((k): k is StructureKind => k !== undefined))].sort(),
    filled: done(FILL_SITE_PREFIX),
    climbed: state.climbed ?? 0,
    captain: defenders.some((u) => u.alive && ctx.rules.units[u.typeKey]?.tags.includes(COMMAND_TAG)),
  };
}
