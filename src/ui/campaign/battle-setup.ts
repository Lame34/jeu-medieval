/**
 * Which battle the URL asks for: the tutorial (`?tutorial`), a campaign castle with the plan the
 * council chose (`?level=roche-grise&plan=lettres`), or a skirmish on any map
 * (`?seed=…&castle=1..4`, the benches' and tests' form).
 */
import { battleEffects } from '../../core/campaign/scenario.ts';
import type { CampaignBattle, CampaignLevel, CastleIndex, Stratagem } from '../../core/campaign/types.ts';
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
}

const DEFAULT_SEED = 'siege-1';

function castleIndexOf(value: string | null): CastleIndex {
  const n = Number(value ?? '1');
  return n === 2 || n === 3 || n === 4 ? n : 1;
}

export function battleSetupFrom(search: string): BattleSetup {
  const query = new URLSearchParams(search);
  if (query.has('tutorial')) {
    const battle = CAMPAIGN.tutorial;
    return { mode: { kind: 'tutorial', battle }, seed: battle.seed, castleIndex: battle.castleIndex };
  }
  const level = CAMPAIGN.levels.find((l) => l.id === query.get('level'));
  if (level) {
    const stratagem = level.stratagems.find((s) => s.id === query.get('plan')) ?? null;
    return { mode: { kind: 'campaign', level, stratagem }, seed: level.seed, castleIndex: level.castleIndex };
  }
  return { mode: { kind: 'skirmish' }, seed: query.get('seed') ?? DEFAULT_SEED, castleIndex: castleIndexOf(query.get('castle')) };
}

/** The battle's identity in a save: its kind, castle or map, plan (one save takes up only its own battle). */
export function battleKey(setup: BattleSetup): string {
  const { mode } = setup;
  if (mode.kind === 'tutorial') return 'tutorial';
  if (mode.kind === 'campaign') return `campaign:${mode.level.id}:${mode.stratagem?.id ?? ''}`;
  return `skirmish:${setup.seed}:${setup.castleIndex}`;
}

/** The query that opens this battle again (the save's address). */
export function battleQuery(setup: BattleSetup): Record<string, string> {
  const { mode } = setup;
  if (mode.kind === 'tutorial') return { tutorial: '' };
  if (mode.kind === 'campaign') return { level: mode.level.id, ...(mode.stratagem ? { plan: mode.stratagem.id } : {}) };
  return { seed: setup.seed, castle: String(setup.castleIndex) };
}

/** The battle's name for the player: the castle's, the trial's, or a skirmish. */
export function battleTitle(setup: BattleSetup): string {
  const { mode } = setup;
  if (mode.kind === 'tutorial') return mode.battle.name;
  if (mode.kind === 'campaign') return mode.level.name;
  return 'Escarmouche';
}

/** The battle's shape: none for a skirmish; the castle's (and the plan's) effects otherwise. */
export function shapeOf(mode: BattleMode, resting: readonly string[]): BattleShape | undefined {
  if (mode.kind === 'tutorial') return { effects: battleEffects(mode.battle, null) };
  if (mode.kind === 'campaign') return { effects: battleEffects(mode.level, mode.stratagem), absentHeroes: resting };
  return undefined;
}
