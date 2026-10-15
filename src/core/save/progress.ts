/**
 * The campaign's progress as it is kept between visits (J6, made strict in J7): the castles taken
 * and their best banners, the heroes resting from a grave wound, the trial battle done. What is
 * read back is checked field by field: a damaged or tampered record is dropped, never trusted,
 * so a bad save can cost a castle's banners but never break the game.
 *
 * Format 2 (ADR-048) adds each castle's fourth banner, its feat of arms. A format-1 save reads with
 * that banner not yet won: no castle, no banner of a player is lost.
 */
import type { Banners } from '../campaign/scenario.ts';

/** Version of the saved progress; a later format reads the earlier ones and upgrades them. */
export const PROGRESS_VERSION = 2;
/** The format before the feats of arms. */
const PROGRESS_V1 = 1;

export interface CastleRecord {
  /** Best banners over the castle's victories. */
  readonly banners: Banners;
  /** The plan of the first victory (a stratagem id), or none. */
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

export const EMPTY_PROGRESS: SavedProgress = { conquered: {}, resting: [], tutorialDone: false, prologueSeen: false };

/** The longest an id may be (a castle's, a plan's, a hero's). */
const MAX_ID_LENGTH = 64;
/** More rounds than any battle lasts: a record beyond it is damaged. */
const MAX_TURNS = 999;

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH && /^[\w-]+$/.test(v);

function castleRecord(raw: unknown, version: number): CastleRecord | null {
  if (!isRecord(raw) || !isRecord(raw['banners'])) return null;
  const b = raw['banners'];
  if (typeof b['taken'] !== 'boolean' || typeof b['swift'] !== 'boolean' || typeof b['spared'] !== 'boolean') return null;
  // Format 1 had no feat of arms: not yet won. From format 2 on, it must be there.
  const feat = version <= PROGRESS_V1 ? false : b['feat'];
  if (typeof feat !== 'boolean') return null;
  const stratagem = raw['stratagem'];
  if (stratagem !== null && !isId(stratagem)) return null;
  const turns = raw['turns'];
  if (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 1 || turns > MAX_TURNS) return null;
  return { banners: { taken: b['taken'], swift: b['swift'], spared: b['spared'], feat }, stratagem, turns };
}

/**
 * The progress read back from storage (already parsed from JSON), checked: unknown fields are
 * ignored, damaged castle records and ids are dropped. `knownCastles`, when given, keeps only the
 * campaign's own castles. Anything but an object reads as a new campaign.
 */
export function parseProgress(raw: unknown, knownCastles?: ReadonlySet<string>): SavedProgress {
  if (!isRecord(raw)) return EMPTY_PROGRESS;
  // A save without a version is of the first format.
  const version = typeof raw['version'] === 'number' && Number.isInteger(raw['version']) ? raw['version'] : PROGRESS_V1;
  const conquered: Record<string, CastleRecord> = {};
  if (isRecord(raw['conquered'])) {
    for (const [id, value] of Object.entries(raw['conquered'])) {
      if (!isId(id) || (knownCastles && !knownCastles.has(id))) continue;
      const record = castleRecord(value, version);
      if (record) conquered[id] = record;
    }
  }
  const resting = Array.isArray(raw['resting']) ? [...new Set(raw['resting'].filter(isId))] : [];
  return { conquered, resting, tutorialDone: raw['tutorialDone'] === true, prologueSeen: raw['prologueSeen'] === true };
}

/** What is written: the progress with its format's version. */
export function serializeProgress(p: SavedProgress): string {
  return JSON.stringify({ version: PROGRESS_VERSION, conquered: p.conquered, resting: p.resting, tutorialDone: p.tutorialDone, prologueSeen: p.prologueSeen });
}

/** Best of two banner sets (a castle's best over its victories). */
export function bestBanners(a: Banners, b: Banners): Banners {
  return { taken: a.taken || b.taken, swift: a.swift || b.swift, spared: a.spared || b.spared, feat: a.feat || b.feat };
}

/**
 * Two progresses merged (another tab's and ours): every castle taken in either, with its best
 * banners and fewest rounds; the lessons and the prologue done in either. The resting heroes are
 * those of `latest`, the one written last.
 */
export function mergeProgress(latest: SavedProgress, other: SavedProgress): SavedProgress {
  const conquered: Record<string, CastleRecord> = { ...other.conquered };
  for (const [id, record] of Object.entries(latest.conquered)) {
    const before = conquered[id];
    conquered[id] = before ? { banners: bestBanners(before.banners, record.banners), stratagem: before.stratagem ?? record.stratagem, turns: Math.min(before.turns, record.turns) } : record;
  }
  return { conquered, resting: latest.resting, tutorialDone: latest.tutorialDone || other.tutorialDone, prologueSeen: latest.prologueSeen || other.prologueSeen };
}
