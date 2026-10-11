/**
 * The campaign's progress (J6), kept in the browser: the castles taken and their best banners,
 * the heroes resting from a grave wound, the tutorial done. A battle ends → recordBattle. What is
 * read back is checked (core/save/progress.ts); another tab's progress is merged in, so two open
 * tabs never undo each other's castles. Storage can fail (private window): the progress then
 * lasts the session.
 */
import { create } from 'zustand';
import type { Banners } from '../core/campaign/scenario.ts';
import type { CampaignData } from '../core/campaign/types.ts';
import { bestBanners, EMPTY_PROGRESS, mergeProgress, parseProgress, serializeProgress, type SavedProgress } from '../core/save/progress.ts';
import { CAMPAIGN } from '../data/index.ts';
import { onOtherTabWrite, readStored, removeStored, writeStored } from './storage.ts';
import { BATTLE_SAVE_KEY } from './battle-save.ts';

export type { CastleRecord, SavedProgress } from '../core/save/progress.ts';

export interface CampaignState extends SavedProgress {
  /** The castle taken last, not yet sealed on the map (its seal is stamped once). */
  readonly fresh: string | null;
  recordBattle(levelId: string, stratagem: string | null, banners: Banners, turns: number, wounded: readonly string[]): void;
  finishTutorial(): void;
  seePrologue(): void;
  sealFresh(): void;
  /** A new campaign: the castles, the banners, the lessons and any battle in progress forgotten. */
  reset(): void;
}

const STORAGE_KEY = 'siege.campaign.v1';
const CASTLES: ReadonlySet<string> = new Set(CAMPAIGN.levels.map((l) => l.id));

const load = (): SavedProgress => parseProgress(readStored(STORAGE_KEY), CASTLES);

export const useCampaign = create<CampaignState>((set) => ({
  ...(typeof window !== 'undefined' ? load() : EMPTY_PROGRESS),
  fresh: null,
  recordBattle: (levelId, stratagem, banners, turns, wounded) =>
    set((s) => {
      const previous = s.conquered[levelId];
      const conquered =
        banners.taken || previous
          ? {
              ...s.conquered,
              [levelId]: previous
                ? { banners: bestBanners(previous.banners, banners), stratagem: previous.stratagem, turns: banners.taken ? Math.min(previous.turns, turns) : previous.turns }
                : { banners, stratagem, turns },
            }
          : s.conquered;
      return { conquered, resting: [...wounded], fresh: banners.taken && !previous ? levelId : s.fresh };
    }),
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
    const theirs = parseProgress(value, CASTLES);
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
  return Object.values(conquered).reduce((n, r) => n + (r.banners.taken ? 1 : 0) + (r.banners.swift ? 1 : 0) + (r.banners.spared ? 1 : 0), 0);
}
