/**
 * The campaign's progress (J6), kept in the browser: the castles taken and their best banners,
 * the heroes resting from a grave wound, the tutorial done. A battle ends → recordBattle. Storage
 * can fail (private window): the progress then lasts the session.
 */
import { create } from 'zustand';
import type { Banners } from '../core/campaign/scenario.ts';
import type { CampaignData } from '../core/campaign/types.ts';

export interface CastleRecord {
  /** Best banners over the castle's victories. */
  readonly banners: Banners;
  /** The plan of the first victory. */
  readonly stratagem: string | null;
  /** Fewest rounds it took. */
  readonly turns: number;
}

export interface SavedProgress {
  readonly conquered: Readonly<Record<string, CastleRecord>>;
  /** Heroes gravely wounded in the last campaign battle: they miss the next one. */
  readonly resting: readonly string[];
  readonly tutorialDone: boolean;
  readonly prologueSeen: boolean;
}

export interface CampaignState extends SavedProgress {
  /** The castle taken last, not yet sealed on the map (its seal is stamped once). */
  readonly fresh: string | null;
  recordBattle(levelId: string, stratagem: string | null, banners: Banners, turns: number, wounded: readonly string[]): void;
  finishTutorial(): void;
  seePrologue(): void;
  sealFresh(): void;
  reset(): void;
}

const STORAGE_KEY = 'siege.campaign.v1';
const EMPTY: SavedProgress = { conquered: {}, resting: [], tutorialDone: false, prologueSeen: false };

function load(): SavedProgress {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return EMPTY;
    const raw = JSON.parse(text) as Partial<SavedProgress>;
    return {
      conquered: typeof raw.conquered === 'object' && raw.conquered !== null ? raw.conquered : {},
      resting: Array.isArray(raw.resting) ? raw.resting.filter((h): h is string => typeof h === 'string') : [],
      tutorialDone: raw.tutorialDone === true,
      prologueSeen: raw.prologueSeen === true,
    };
  } catch {
    return EMPTY;
  }
}

function save(p: SavedProgress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ conquered: p.conquered, resting: p.resting, tutorialDone: p.tutorialDone, prologueSeen: p.prologueSeen }));
  } catch {
    // Not saved: the progress holds for this session.
  }
}

const best = (a: Banners, b: Banners): Banners => ({ taken: a.taken || b.taken, swift: a.swift || b.swift, spared: a.spared || b.spared });

export const useCampaign = create<CampaignState>((set) => ({
  ...(typeof window !== 'undefined' ? load() : EMPTY),
  fresh: null,
  recordBattle: (levelId, stratagem, banners, turns, wounded) =>
    set((s) => {
      const previous = s.conquered[levelId];
      const conquered =
        banners.taken || previous
          ? {
              ...s.conquered,
              [levelId]: previous
                ? { banners: best(previous.banners, banners), stratagem: previous.stratagem, turns: banners.taken ? Math.min(previous.turns, turns) : previous.turns }
                : { banners, stratagem, turns },
            }
          : s.conquered;
      return { conquered, resting: [...wounded], fresh: banners.taken && !previous ? levelId : s.fresh };
    }),
  finishTutorial: () => set({ tutorialDone: true }),
  seePrologue: () => set({ prologueSeen: true }),
  sealFresh: () => set({ fresh: null }),
  reset: () => set({ ...EMPTY, fresh: null }),
}));

if (typeof window !== 'undefined') useCampaign.subscribe((s) => save(s));

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
