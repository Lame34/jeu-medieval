/**
 * The host's tents between two sieges (ADR-049). The banners won bring marcs of silver, each
 * once: the ransoms and the coffers of the castles taken. With them the player buys provisions
 * for the next siege (the soldiers' pay, fagots, a second mangonel…) or the mire's care for a
 * companion gravely wounded. The purse is never stored as such: it is what the banners are
 * worth, less what was spent and what the provisions waiting have cost, so two tabs or a
 * replayed castle cannot coin money.
 */
import { bannerCount, type Banners } from './scenario.ts';
import type { CampaignData, Provision } from './types.ts';

/** What the purse is reckoned from (the campaign's progress). */
export interface Coffer {
  readonly conquered: Readonly<Record<string, { readonly banners: Banners }>>;
  /** Marcs spent: provisions used up in a siege, the mire's fees. */
  readonly spent: number;
  /** Provisions bought and waiting for the next siege (ids). */
  readonly pending: readonly string[];
}

/** Marcs the banners won have brought. */
export function earned(campaign: CampaignData, conquered: Coffer['conquered']): number {
  return Object.values(conquered).reduce((n, r) => n + bannerCount(r.banners) * campaign.camp.perBanner, 0);
}

/** The provisions named by `ids`, in the tents' order (unknown ids are left out). */
export function provisionsOf(campaign: CampaignData, ids: readonly string[]): readonly Provision[] {
  return campaign.camp.provisions.filter((p) => ids.includes(p.id));
}

/** What `ids` cost. */
export function priceOf(campaign: CampaignData, ids: readonly string[]): number {
  return provisionsOf(campaign, ids).reduce((n, p) => n + p.price, 0);
}

/** Marcs in the coffer now (never below nothing). */
export function purse(campaign: CampaignData, coffer: Coffer): number {
  return Math.max(0, earned(campaign, coffer.conquered) - coffer.spent - priceOf(campaign, coffer.pending));
}

/** Can the provision `id` be bought: known, not bought already, and paid for. */
export function canBuy(campaign: CampaignData, coffer: Coffer, id: string): boolean {
  const provision = campaign.camp.provisions.find((p) => p.id === id);
  return provision !== undefined && !coffer.pending.includes(id) && provision.price <= purse(campaign, coffer);
}

/** Can the mire be paid. */
export function canHeal(campaign: CampaignData, coffer: Coffer): boolean {
  return campaign.camp.healPrice <= purse(campaign, coffer);
}
