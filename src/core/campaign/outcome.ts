/**
 * What the campaign's progress becomes (J6, ADR-049, ADR-050): after a battle fought to its end —
 * the castle taken and its best banners, the deeds the chronicle tells, the failed assaults, the
 * wounded who rest, the provisions used up and paid for — and at the tents, a provision bought or
 * given back, the mire's care. Pure: the store only keeps what these return.
 */
import { canBuy, canHeal, priceOf } from './camp.ts';
import type { BattleDeeds } from './deeds.ts';
import type { Banners } from './scenario.ts';
import type { CampaignData } from './types.ts';
import { bestBanners, chronicledDeeds, type SavedProgress } from '../save/progress.ts';

/** What a campaign battle fought to its end leaves. */
export interface BattleOutcome {
  /** The plan sealed at the council, or none. */
  readonly stratagem: string | null;
  readonly banners: Banners;
  readonly turns: number;
  /** Companions gravely wounded: they rest through the next battle. */
  readonly wounded: readonly string[];
  /** The deeds of a victory, for the chronicle (null for a defeat). */
  readonly deeds: BattleDeeds | null;
  /** The provisions it began with: used up now, won or lost. */
  readonly provisions: readonly string[];
}

export function withOutcome(campaign: CampaignData, p: SavedProgress, levelId: string, o: BattleOutcome): SavedProgress {
  const previous = p.conquered[levelId];
  let conquered = p.conquered;
  if (o.banners.taken || previous) {
    const record = previous
      ? { banners: bestBanners(previous.banners, o.banners), stratagem: previous.stratagem, turns: o.banners.taken ? Math.min(previous.turns, o.turns) : previous.turns }
      : { banners: o.banners, stratagem: o.stratagem, turns: o.turns };
    const deeds = chronicledDeeds(previous?.deeds, o.deeds ?? undefined);
    conquered = { ...p.conquered, [levelId]: { ...record, ...(deeds ? { deeds } : {}) } };
  }
  // An assault that failed before the castle fell is remembered: the chronicle tells them.
  const failed = !o.banners.taken && !previous ? { ...p.failed, [levelId]: (p.failed[levelId] ?? 0) + 1 } : p.failed;
  return {
    ...p,
    conquered,
    failed,
    resting: [...o.wounded],
    // The provisions it began with are used up, won or lost, and paid for.
    pending: p.pending.filter((id) => !o.provisions.includes(id)),
    spent: p.spent + priceOf(campaign, o.provisions),
  };
}

/** A provision bought for the next siege (unchanged if it cannot be). */
export function withPurchase(campaign: CampaignData, p: SavedProgress, id: string): SavedProgress {
  return canBuy(campaign, p, id) ? { ...p, pending: [...p.pending, id] } : p;
}

/** A provision given back before the siege: its price returns to the coffer. */
export function withoutPurchase(p: SavedProgress, id: string): SavedProgress {
  return { ...p, pending: p.pending.filter((x) => x !== id) };
}

/** The mire's care: a companion gravely wounded is fit for the next siege, for his fee. */
export function withHealing(campaign: CampaignData, p: SavedProgress, hero: string): SavedProgress {
  return p.resting.includes(hero) && canHeal(campaign, p) ? { ...p, resting: p.resting.filter((h) => h !== hero), spent: p.spent + campaign.camp.healPrice } : p;
}
