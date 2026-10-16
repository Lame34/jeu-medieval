/**
 * The campaign's progress (J6), kept in the browser: the castles taken and their best banners,
 * the heroes resting from a grave wound, the tutorial done, the tents' accounts and the deeds the
 * chronicle tells. A battle ends → recordBattle; at the tents → buy, giveBack, heal. What is
 * read back is checked (core/save/progress.ts); another tab's progress is merged in, so two open
 * tabs never undo each other's castles. Storage can fail (private window): the progress then
 * lasts the session.
 */
import { create } from 'zustand';
import { withHealing, withOutcome, withoutPurchase, withPurchase, type BattleOutcome } from '../core/campaign/outcome.ts';
import { bannerCount } from '../core/campaign/scenario.ts';
import type { CampaignData } from '../core/campaign/types.ts';
import { EMPTY_PROGRESS, mergeProgress, parseProgress, serializeProgress, type SavedProgress } from '../core/save/progress.ts';
import { CAMPAIGN } from '../data/index.ts';
import { onOtherTabWrite, readStored, removeStored, writeStored } from './storage.ts';
import { BATTLE_SAVE_KEY } from './battle-save.ts';

export type { CastleRecord, SavedProgress } from '../core/save/progress.ts';

export type { BattleOutcome } from '../core/campaign/outcome.ts';

export interface CampaignState extends SavedProgress {
  /** The castle taken last, not yet sealed on the map (its seal is stamped once). */
  readonly fresh: string | null;
  recordBattle(levelId: string, outcome: BattleOutcome): void;
  /** At the tents: a provision bought for the next siege, or given back before it. */
  buy(provisionId: string): void;
  giveBack(provisionId: string): void;
  /** The mire's care: a companion gravely wounded is fit for the next siege. */
  heal(heroId: string): void;
  finishTutorial(): void;
  seePrologue(): void;
  sealFresh(): void;
  /** A new campaign: the castles, the banners, the lessons and any battle in progress forgotten. */
  reset(): void;
}

const STORAGE_KEY = 'siege.campaign.v1';
const KNOWN = { castles: new Set(CAMPAIGN.levels.map((l) => l.id)), provisions: new Set(CAMPAIGN.camp.provisions.map((p) => p.id)) };

const load = (): SavedProgress => parseProgress(readStored(STORAGE_KEY), KNOWN);

export const useCampaign = create<CampaignState>((set) => ({
  ...(typeof window !== 'undefined' ? load() : EMPTY_PROGRESS),
  fresh: null,
  // The rules of it are the core's (core/campaign/outcome.ts); the store keeps what they return.
  recordBattle: (levelId, o) => set((s) => ({ ...withOutcome(CAMPAIGN, s, levelId, o), fresh: o.banners.taken && !s.conquered[levelId] ? levelId : s.fresh })),
  buy: (id) => set((s) => withPurchase(CAMPAIGN, s, id)),
  giveBack: (id) => set((s) => withoutPurchase(s, id)),
  heal: (hero) => set((s) => withHealing(CAMPAIGN, s, hero)),
  finishTutorial: () => set({ tutorialDone: true }),
  seePrologue: () => set({ prologueSeen: true }),
  sealFresh: () => set({ fresh: null }),
  reset: () => {
    removeStored(BATTLE_SAVE_KEY);
    set({ ...EMPTY_PROGRESS, fresh: null });
  },
}));

if (typeof window !== 'undefined') {
  // Every change is written at once, merged with what another tab may have written since.
  let merging = false;
  useCampaign.subscribe((s) => {
    if (merging) return;
    writeStored(STORAGE_KEY, serializeProgress(s));
  });
  onOtherTabWrite(STORAGE_KEY, (value) => {
    const theirs = parseProgress(value, KNOWN);
    merging = true;
    // A wipe in another tab is a new campaign here too; otherwise their castles join ours.
    useCampaign.setState(value === undefined ? { ...EMPTY_PROGRESS } : mergeProgress(theirs, useCampaign.getState()));
    merging = false;
  });
}

/** Is the level open: the first one, or the one after a castle taken. */
export function isUnlocked(campaign: CampaignData, conquered: SavedProgress['conquered'], index: number): boolean {
  if (index <= 0) return true;
  const previous = campaign.levels[index - 1];
  return previous !== undefined && conquered[previous.id] !== undefined;
}

/** Banners won over the whole campaign. */
export function bannerTotal(conquered: SavedProgress['conquered']): number {
  return Object.values(conquered).reduce((n, r) => n + bannerCount(r.banners), 0);
}
