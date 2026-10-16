/**
 * The campaign's progress as it is kept between visits (J6, made strict in J7): the castles taken
 * and their best banners, the heroes resting from a grave wound, the trial battle done. What is
 * read back is checked field by field: a damaged or tampered record is dropped, never trusted,
 * so a bad save can cost a castle's banners but never break the game.
 *
 * Format 2 (ADR-048) adds each castle's fourth banner, its feat of arms. A format-1 save reads with
 * that banner not yet won: no castle, no banner of a player is lost.
 *
 * Format 3 (ADR-049, ADR-050) adds the tents' accounts (the marcs spent, the provisions waiting),
 * the assaults that failed before a castle fell, and the deeds of the battle each chapter of the
 * chronicle tells. An earlier save reads with nothing spent (its banners' marcs all in the
 * coffer), no provision, no failed assault, and no deeds: the chronicle tells those castles from
 * what it knows.
 */
import type { Banners } from '../campaign/scenario.ts';
import { DEED_ENDINGS, type BattleDeeds, type DeedEnding } from '../campaign/deeds.ts';
import { RANKS, type Rank } from '../campaign/types.ts';
import type { StructureKind } from '../battle/structures.ts';
import { bannerCount } from '../campaign/scenario.ts';

/** Version of the saved progress; a later format reads the earlier ones and upgrades them. */
export const PROGRESS_VERSION = 3;
/** The format before the feats of arms. */
const PROGRESS_V1 = 1;

export interface CastleRecord {
  /** Best banners over the castle's victories. */
  readonly banners: Banners;
  /** The plan of the first victory (a stratagem id), or none. */
  readonly stratagem: string | null;
  /** Fewest rounds it took. */
  readonly turns: number;
  /** The deeds of the victory the chronicle tells (the one with the most banners); none before format 3. */
  readonly deeds?: BattleDeeds;
}

export interface SavedProgress {
  readonly conquered: Readonly<Record<string, CastleRecord>>;
  /** Heroes gravely wounded in the last campaign battle: they miss the next one. */
  readonly resting: readonly string[];
  readonly tutorialDone: boolean;
  readonly prologueSeen: boolean;
  /** Marcs of silver spent at the tents: provisions used up, the mire's fees. */
  readonly spent: number;
  /** Provisions bought and waiting for the next siege. */
  readonly pending: readonly string[];
  /** Assaults that failed, by castle, before it fell. */
  readonly failed: Readonly<Record<string, number>>;
}

export const EMPTY_PROGRESS: SavedProgress = { conquered: {}, resting: [], tutorialDone: false, prologueSeen: false, spent: 0, pending: [], failed: {} };

/** What the progress is checked against: the campaign's castles and provisions, when known. */
export interface ProgressKnown {
  readonly castles?: ReadonlySet<string>;
  readonly provisions?: ReadonlySet<string>;
}

/** The longest an id may be (a castle's, a plan's, a hero's). */
const MAX_ID_LENGTH = 64;
/** More rounds than any battle lasts: a record beyond it is damaged. */
const MAX_TURNS = 999;
/** More men, works or assaults than any battle has: a figure beyond it is damaged. */
const MAX_COUNT = 999;
/** More marcs than a campaign brings: a figure beyond it is damaged. */
const MAX_MARCS = 1_000_000;
/** The kinds of works a battle's deeds may name. */
const STRUCTURE_KINDS: readonly StructureKind[] = ['wall', 'gate', 'portcullis', 'drawbridge'];

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH && /^[\w-]+$/.test(v);
const isCount = (v: unknown, max = MAX_COUNT): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const ids = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter(isId))] : []);

function readBanners(raw: unknown, version: number): Banners | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['taken'] !== 'boolean' || typeof raw['swift'] !== 'boolean' || typeof raw['spared'] !== 'boolean') return null;
  // Format 1 had no feat of arms: not yet won. From format 2 on, it must be there.
  const feat = version <= PROGRESS_V1 ? false : raw['feat'];
  if (typeof feat !== 'boolean') return null;
  return { taken: raw['taken'], swift: raw['swift'], spared: raw['spared'], feat };
}

/** A battle's deeds read back, checked whole: anything amiss and they are dropped (the castle stays). */
export function parseDeeds(raw: unknown): BattleDeeds | null {
  if (!isRecord(raw)) return null;
  const banners = readBanners(raw['banners'], PROGRESS_VERSION);
  const { stratagem, rank, ending } = raw;
  if (!banners || (stratagem !== null && !isId(stratagem))) return null;
  if (!(RANKS as readonly unknown[]).includes(rank) || !(DEED_ENDINGS as readonly unknown[]).includes(ending)) return null;
  if (!Array.isArray(raw['provisions']) || !raw['provisions'].every(isId) || !Array.isArray(raw['wounded']) || !raw['wounded'].every(isId)) return null;
  const counts = ['turns', 'turnLimit', 'lost', 'slain', 'garrison', 'breaches', 'mined', 'filled', 'climbed', 'assault'] as const;
  if (!counts.every((k) => isCount(raw[k]))) return null;
  const flags = ['gate', 'portcullis', 'drawbridge', 'captain'] as const;
  const burned = raw['burned'];
  if (!Array.isArray(burned) || !burned.every((k) => (STRUCTURE_KINDS as readonly unknown[]).includes(k))) return null;
  if (!flags.every((k) => typeof raw[k] === 'boolean')) return null;
  const n = (k: (typeof counts)[number]) => raw[k] as number;
  const f = (k: (typeof flags)[number]) => raw[k] as boolean;
  if (n('turns') < 1 || n('assault') < 1) return null;
  return {
    banners,
    stratagem: stratagem as string | null,
    rank: rank as Rank,
    provisions: [...(raw['provisions'] as string[])],
    wounded: [...(raw['wounded'] as string[])],
    ending: ending as DeedEnding,
    turns: n('turns'),
    turnLimit: n('turnLimit'),
    lost: n('lost'),
    slain: n('slain'),
    garrison: n('garrison'),
    breaches: n('breaches'),
    mined: n('mined'),
    gate: f('gate'),
    portcullis: f('portcullis'),
    drawbridge: f('drawbridge'),
    burned: [...new Set(burned as StructureKind[])].sort(),
    filled: n('filled'),
    climbed: n('climbed'),
    captain: f('captain'),
    assault: n('assault'),
  };
}

function castleRecord(raw: unknown, version: number): CastleRecord | null {
  if (!isRecord(raw)) return null;
  const banners = readBanners(raw['banners'], version);
  if (!banners) return null;
  const stratagem = raw['stratagem'];
  if (stratagem !== null && !isId(stratagem)) return null;
  const turns = raw['turns'];
  if (typeof turns !== 'number' || !Number.isInteger(turns) || turns < 1 || turns > MAX_TURNS) return null;
  const deeds = raw['deeds'] === undefined ? null : parseDeeds(raw['deeds']);
  return { banners, stratagem, turns, ...(deeds ? { deeds } : {}) };
}

/**
 * The progress read back from storage (already parsed from JSON), checked: unknown fields are
 * ignored, damaged castle records and ids are dropped. `known`, when given, keeps only the
 * campaign's own castles and provisions. Anything but an object reads as a new campaign.
 */
export function parseProgress(raw: unknown, known: ProgressKnown = {}): SavedProgress {
  if (!isRecord(raw)) return EMPTY_PROGRESS;
  // A save without a version is of the first format.
  const version = typeof raw['version'] === 'number' && Number.isInteger(raw['version']) ? raw['version'] : PROGRESS_V1;
  const conquered: Record<string, CastleRecord> = {};
  if (isRecord(raw['conquered'])) {
    for (const [id, value] of Object.entries(raw['conquered'])) {
      if (!isId(id) || (known.castles && !known.castles.has(id))) continue;
      const record = castleRecord(value, version);
      if (record) conquered[id] = record;
    }
  }
  const failed: Record<string, number> = {};
  if (isRecord(raw['failed'])) {
    for (const [id, n] of Object.entries(raw['failed'])) {
      if (isId(id) && (!known.castles || known.castles.has(id)) && isCount(n) && n > 0) failed[id] = n;
    }
  }
  return {
    conquered,
    resting: ids(raw['resting']),
    tutorialDone: raw['tutorialDone'] === true,
    prologueSeen: raw['prologueSeen'] === true,
    spent: isCount(raw['spent'], MAX_MARCS) ? raw['spent'] : 0,
    pending: ids(raw['pending']).filter((p) => !known.provisions || known.provisions.has(p)),
    failed,
  };
}

/** What is written: the progress with its format's version. */
export function serializeProgress(p: SavedProgress): string {
  return JSON.stringify({ version: PROGRESS_VERSION, conquered: p.conquered, resting: p.resting, tutorialDone: p.tutorialDone, prologueSeen: p.prologueSeen, spent: p.spent, pending: p.pending, failed: p.failed });
}

/** Best of two banner sets (a castle's best over its victories). */
export function bestBanners(a: Banners, b: Banners): Banners {
  return { taken: a.taken || b.taken, swift: a.swift || b.swift, spared: a.spared || b.spared, feat: a.feat || b.feat };
}

/** The deeds the chronicle keeps of two: those of the battle with more banners, `newer` on a tie. */
export function chronicledDeeds(older: BattleDeeds | undefined, newer: BattleDeeds | undefined): BattleDeeds | undefined {
  if (!older || !newer) return newer ?? older;
  return bannerCount(newer.banners) >= bannerCount(older.banners) ? newer : older;
}

/**
 * Two progresses merged (another tab's and ours): every castle taken in either, with its best
 * banners, fewest rounds and the deeds of its best battle; the lessons and the prologue done in
 * either; the most marcs spent and failed assaults either counted. The resting heroes and the
 * provisions waiting are those of `latest`, the one written last.
 */
export function mergeProgress(latest: SavedProgress, other: SavedProgress): SavedProgress {
  const conquered: Record<string, CastleRecord> = { ...other.conquered };
  for (const [id, record] of Object.entries(latest.conquered)) {
    const before = conquered[id];
    if (!before) {
      conquered[id] = record;
      continue;
    }
    const deeds = chronicledDeeds(before.deeds, record.deeds);
    conquered[id] = { banners: bestBanners(before.banners, record.banners), stratagem: before.stratagem ?? record.stratagem, turns: Math.min(before.turns, record.turns), ...(deeds ? { deeds } : {}) };
  }
  const failed: Record<string, number> = { ...other.failed };
  for (const [id, n] of Object.entries(latest.failed)) failed[id] = Math.max(n, failed[id] ?? 0);
  return {
    conquered,
    resting: latest.resting,
    tutorialDone: latest.tutorialDone || other.tutorialDone,
    prologueSeen: latest.prologueSeen || other.prologueSeen,
    spent: Math.max(latest.spent, other.spent),
    pending: latest.pending,
    failed,
  };
}
