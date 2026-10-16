/**
 * The campaign (J6): a tutorial battle and five castles of the Val d'Orle, each taken in a battle
 * shaped by the castle (its garrison, the hour, the weather) and by the stratagem the player picks
 * at the council of war, one per hero. Every effect is written into the battle's Scenario, so a
 * campaign battle replays like any other (seed + scenario + commands).
 */
import type { Weather } from '../battle/conditions.ts';
import type { StructureKind } from '../battle/structures.ts';
import type { Faction } from '../rules/types.ts';
import type { GarrisonGroup } from '../worldgen/garrison.ts';

/** Defenders left out of the battle (deserters, men elsewhere): `count` of a group and/or a type. */
export interface GarrisonCut {
  readonly group?: GarrisonGroup;
  readonly typeKey?: string;
  readonly count: number;
}

/** Attackers joining the army, behind it (engines behind the siege park). */
export interface Reinforcement {
  readonly typeKey: string;
  readonly count: number;
}

/** The castle's structure of this kind nearest the army, damaged or down at the start. */
export interface StructureEffect {
  readonly kind: StructureKind;
  /** Remaining HP over maximum, in (0, 1]. */
  readonly hpFraction?: number;
  readonly broken?: boolean;
}

/** What shapes a battle: the castle's own conditions, then a stratagem's changes. */
export interface BattleEffects {
  /** Fixed weather and start hour (later effects win). */
  readonly weather?: Weather;
  readonly startHour?: number;
  /** The siege's month (ADR-052), an id of rules.weather.seasons: the campaign runs from April to October. */
  readonly season?: string;
  /** Rounds the garrison must hold (the rules' limit when absent). */
  readonly turnLimit?: number;
  /** Rounds won or lost (the time a stratagem takes, added up). */
  readonly turnDelta?: number;
  /** Added to a side's starting morale. */
  readonly morale?: Readonly<Partial<Record<Faction, number>>>;
  readonly cut?: readonly GarrisonCut[];
  readonly reinforce?: readonly Reinforcement[];
  readonly structures?: readonly StructureEffect[];
  /** Moat slots already crossed by fascines, in front of the walls nearest the siege towers. */
  readonly fillMoat?: number;
  /** Added to a side's skill at arms: the hit chance of its men's blows and shots (the player's rank). */
  readonly aim?: Readonly<Partial<Record<Faction, number>>>;
  /** The garrison's captain swore never to yield: no summons moves it while he stands (ADR-047). */
  readonly sworn?: boolean;
}

/** What a castle's feat of arms asks (ADR-048), each judged on the battle's end. */
export const FEAT_KINDS = ['summons', 'mine', 'tower', 'fire', 'captive'] as const;
export type FeatKind = (typeof FEAT_KINDS)[number];

/** A castle's feat of arms: a deed of a real siege, its fourth banner. */
export interface Feat {
  readonly kind: FeatKind;
  /** « Par la sommation ». */
  readonly name: string;
  /** What to do, in a sentence. */
  readonly task: string;
  /** The siege it comes from, told for a player who knows the period. */
  readonly history: string;
  /** What the chronicle adds when the feat is done (« Ainsi s’étaient rendus… »). */
  readonly told: string;
}

/** The player's rank in a siege (ADR-045): how hard the castle holds, chosen at the council. */
export const RANKS = ['squire', 'knight', 'baron'] as const;
export type Rank = (typeof RANKS)[number];
/** The rank of a battle that names none (the castle as the scouts saw it). */
export const DEFAULT_RANK: Rank = 'knight';

export interface RankRule {
  /** « Écuyer », « Chevalier », « Baron ». */
  readonly name: string;
  /** What it changes, in a sentence for the council. */
  readonly summary: string;
  /** Added after the castle's and the plan's. */
  readonly effects: BattleEffects;
  /** The castle's own absentees are back at their posts (the garrison at full strength). */
  readonly fullGarrison: boolean;
}

/** A hero's plan at the council of war. */
export interface Stratagem {
  readonly id: string;
  /** The hero who proposes it (a key of the rules' heroes). */
  readonly hero: string;
  readonly name: string;
  /** The hero's words. */
  readonly pitch: string;
  readonly effects: BattleEffects;
}

/** Castle drawings of the campaign map. */
export const VIGNETTES = ['fort', 'keep', 'mill', 'marsh', 'hoardings', 'citadel'] as const;
export type Vignette = (typeof VIGNETTES)[number];

export type CastleIndex = 1 | 2 | 3 | 4;

/** A battle of the campaign: the castle, its story, its map and its conditions. */
export interface CampaignBattle {
  readonly id: string;
  readonly name: string;
  /** "la sentinelle des collines". */
  readonly epithet: string;
  readonly lord: string;
  /** The lord's words, on the castle's letter. */
  readonly lordLine: string;
  readonly intro: string;
  /** The chronicle's page, won or lost. */
  readonly victory: string;
  readonly defeat: string;
  readonly seed: string;
  readonly castleIndex: CastleIndex;
  readonly vignette: Vignette;
  /** Place on the campaign map (0–1 across, 0–1 down). */
  readonly map: { readonly x: number; readonly y: number };
  /** 1–5 shields. */
  readonly difficulty: number;
  readonly battle: BattleEffects;
}

export interface CampaignLevel extends CampaignBattle {
  /** Three, one per hero. */
  readonly stratagems: readonly Stratagem[];
  /** The feat of arms to try there (the fourth banner). */
  readonly feat: Feat;
}

/** A hero's words after a campaign battle. */
export interface HeroCampaignLines {
  readonly victory: readonly string[];
  readonly defeat: readonly string[];
  /** While the hero rests (they miss the battle after a grave wound). */
  readonly resting: string;
}

/**
 * A provision of the host's tents (ADR-049): bought with the marcs of silver the banners bring,
 * it weighs on the next siege fought to its end, then it is spent.
 */
export interface Provision {
  readonly id: string;
  /** « L’ost payé ». */
  readonly name: string;
  /** Its price, in marcs of silver. */
  readonly price: number;
  /** What it brings, in a sentence. */
  readonly summary: string;
  /** What the chronicle says of it (« Les hommes avaient été payés… »). */
  readonly told: string;
  readonly effects: BattleEffects;
}

/** The chronicle's own words (ADR-050): its title, its opening, its end. */
export interface ChronicleTexts {
  readonly title: string;
  /** « Ci commence… », in red. */
  readonly incipit: string;
  readonly preface: string;
  /** For a castle taken before the chronicle was kept. */
  readonly unwritten: string;
  /** While castles remain to be taken. */
  readonly unfinished: string;
  /** « Ci finit… ». */
  readonly explicit: string;
}

/** The tents between two sieges: what a banner is worth, the mire's fee, the provisions. */
export interface CampRules {
  /** Marcs of silver a banner brings, once (the ransoms and the castle's coffers). */
  readonly perBanner: number;
  /** The mire's fee, to heal a companion gravely wounded. */
  readonly healPrice: number;
  readonly provisions: readonly Provision[];
}

export interface CampaignData {
  readonly realm: string;
  readonly prologue: string;
  readonly epilogue: string;
  readonly tutorial: CampaignBattle;
  readonly levels: readonly CampaignLevel[];
  /** The banners of a victory: taken, swiftly (within this share of the turn limit), with few losses (and its feat of arms). */
  readonly banners: { readonly swiftShare: number; readonly maxLosses: number };
  readonly camp: CampRules;
  /** Each month's line in a castle's letter and briefing (ADR-052), by season id. */
  readonly seasons: Readonly<Record<string, string>>;
  readonly chronicle: ChronicleTexts;
  readonly ranks: Readonly<Record<Rank, RankRule>>;
  readonly heroLines: Readonly<Record<string, HeroCampaignLines>>;
}
