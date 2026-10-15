/**
 * Which battle the URL asks for: the tutorial (`?tutorial`), a campaign castle with the plan the
 * council chose (`?level=roche-grise&plan=lettres`), or a skirmish on any map
 * (`?seed=…&castle=1..4`, the benches' and tests' form); for a castle or a skirmish, the player's
 * rank (`&rank=squire|baron`, the knight's when absent: ADR-045).
 */
import { battleEffects } from '../../core/campaign/scenario.ts';
import { DEFAULT_RANK, RANKS, type CampaignBattle, type CampaignLevel, type CastleIndex, type Rank, type Stratagem } from '../../core/campaign/types.ts';
import { CAMPAIGN } from '../../data/index.ts';
import type { BattleShape } from '../battle/session.ts';

export type BattleMode =
  | { readonly kind: 'skirmish' }
  | { readonly kind: 'tutorial'; readonly battle: CampaignBattle }
  | { readonly kind: 'campaign'; readonly level: CampaignLevel; readonly stratagem: Stratagem | null };

export interface BattleSetup {
  readonly mode: BattleMode;
  readonly seed: string;
  readonly castleIndex: CastleIndex;
  /** The player's rank (the trial battle, a lesson, has the knight's: it changes nothing). */
  readonly rank: Rank;
}

const DEFAULT_SEED = 'siege-1';

/** A rank named in the address, or the knight's. */
export function rankOf(value: string | null): Rank {
  return (RANKS as readonly (string | null)[]).includes(value) ? (value as Rank) : DEFAULT_RANK;
}

function castleIndexOf(value: string | null): CastleIndex {
  const n = Number(value ?? '1');
  return n === 2 || n === 3 || n === 4 ? n : 1;
}

export function battleSetupFrom(search: string): BattleSetup {
  const query = new URLSearchParams(search);
  if (query.has('tutorial')) {
    const battle = CAMPAIGN.tutorial;
    return { mode: { kind: 'tutorial', battle }, seed: battle.seed, castleIndex: battle.castleIndex, rank: DEFAULT_RANK };
  }
  const rank = rankOf(query.get('rank'));
  const level = CAMPAIGN.levels.find((l) => l.id === query.get('level'));
  if (level) {
    const stratagem = level.stratagems.find((s) => s.id === query.get('plan')) ?? null;
    return { mode: { kind: 'campaign', level, stratagem }, seed: level.seed, castleIndex: level.castleIndex, rank };
  }
  return { mode: { kind: 'skirmish' }, seed: query.get('seed') ?? DEFAULT_SEED, castleIndex: castleIndexOf(query.get('castle')), rank };
}

/**
 * The battle's identity in a save: its kind, castle or map, plan, rank (one save takes up only its
 * own battle). The knight's rank adds nothing: the keys of earlier saves stay the same.
 */
export function battleKey(setup: BattleSetup): string {
  const { mode } = setup;
  if (mode.kind === 'tutorial') return 'tutorial';
  const rank = setup.rank === DEFAULT_RANK ? '' : `:${setup.rank}`;
  if (mode.kind === 'campaign') return `campaign:${mode.level.id}:${mode.stratagem?.id ?? ''}${rank}`;
  return `skirmish:${setup.seed}:${setup.castleIndex}${rank}`;
}

/** The query that opens this battle again (the save's address). */
export function battleQuery(setup: BattleSetup): Record<string, string> {
  const { mode } = setup;
  if (mode.kind === 'tutorial') return { tutorial: '' };
  const rank: Record<string, string> = setup.rank === DEFAULT_RANK ? {} : { rank: setup.rank };
  if (mode.kind === 'campaign') return { level: mode.level.id, ...(mode.stratagem ? { plan: mode.stratagem.id } : {}), ...rank };
  return { seed: setup.seed, castle: String(setup.castleIndex), ...rank };
}

/** The battle's name for the player: the castle's, the trial's, or a skirmish. */
export function battleTitle(setup: BattleSetup): string {
  const { mode } = setup;
  if (mode.kind === 'tutorial') return mode.battle.name;
  if (mode.kind === 'campaign') return mode.level.name;
  return 'Escarmouche';
}

/** The battle's shape: the castle's (and the plan's) effects, then the rank's; a knight's skirmish has none. */
export function shapeOf(mode: BattleMode, resting: readonly string[], rank: Rank): BattleShape | undefined {
  if (mode.kind === 'tutorial') return { effects: battleEffects(mode.battle, null) };
  if (mode.kind === 'campaign') return { effects: battleEffects(mode.level, mode.stratagem, CAMPAIGN.ranks[rank]), absentHeroes: resting };
  return rank === DEFAULT_RANK ? undefined : { effects: [CAMPAIGN.ranks[rank].effects] };
}
