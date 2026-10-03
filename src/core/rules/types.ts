/**
 * Game rule types. Values live in src/data/*.json and are validated by ./validate.ts;
 * the core never hard-codes a tunable number.
 */

export const MOVEMENT_PROFILES = ['lightFoot', 'foot', 'mounted', 'engine'] as const;
export type MovementProfile = (typeof MOVEMENT_PROFILES)[number];

export const COVER_LEVELS = ['none', 'light', 'partial', 'heavy'] as const;
export type CoverLevel = (typeof COVER_LEVELS)[number];

export const MATERIALS = ['earth', 'vegetation', 'wood', 'stone', 'water'] as const;
export type Material = (typeof MATERIALS)[number];

export const ARMOR_CLASSES = ['light', 'medium', 'heavy', 'wood', 'stone'] as const;
export type ArmorClass = (typeof ARMOR_CLASSES)[number];

export const DAMAGE_TYPES = ['piercing', 'blunt', 'fire', 'siege'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const FACTIONS = ['attacker', 'defender'] as const;
export type Faction = (typeof FACTIONS)[number];

/**
 * Navigation layers. The numeric id is stored per 1 m cell in a Uint8Array; the same layer map
 * drives both the simulation and the ground splat of the renderer.
 */
export const TerrainLayer = {
  Plain: 0,
  Road: 1,
  Field: 2,
  Forest: 3,
  Mud: 4,
  Ford: 5,
  River: 6,
  Moat: 7,
  Rock: 8,
  Building: 9,
  Wall: 10,
  Bridge: 11,
  Rubble: 12,
  Hedge: 13,
  DryStoneWall: 14,
  /** Wall-walks and tower tops: a deck raised above the relief (nav decks, J4). */
  Rampart: 15,
  /** Stairs up to the wall-walk, their deck rising step by step. */
  Stair: 16,
  /** Fascines filling the moat (J4): a causeway just under the sill, flammable. */
  Fascine: 17,
} as const;
export type TerrainLayerId = (typeof TerrainLayer)[keyof typeof TerrainLayer];
export type TerrainLayerKey = keyof typeof TerrainLayer;
export const TERRAIN_LAYER_KEYS = Object.keys(TerrainLayer) as TerrainLayerKey[];
export const TERRAIN_LAYER_COUNT = TERRAIN_LAYER_KEYS.length;

export interface SightRule {
  /** Height above ground (m) up to which the layer obstructs sight. 0 = transparent. */
  readonly heightM: number;
  /** Obscurance accumulated per metre crossed; ≥ 1 means opaque. */
  readonly densityPerM: number;
}

export interface TerrainLayerRule {
  readonly key: TerrainLayerKey;
  readonly id: TerrainLayerId;
  /** Metres travelled per action point, per movement profile. 0 = impassable. */
  readonly metersPerAp: Readonly<Record<MovementProfile, number>>;
  readonly cover: CoverLevel;
  /** Hedges and dry-stone walls only protect against fire coming across them. */
  readonly directionalCover: boolean;
  readonly flammable: boolean;
  readonly material: Material;
  readonly sight: SightRule;
  /** Walkable deck above the relief (bridges): the ground slope underneath is ignored. */
  readonly flatDeck: boolean;
}

export interface MovementRules {
  /** Extra cost fraction per unit of uphill grade (rise / run). */
  readonly uphillPenaltyPerGrade: number;
  /** Steeper cells are impassable for the profile. */
  readonly maxWalkableGrade: Readonly<Record<MovementProfile, number>>;
  readonly eyeHeightM: number;
  readonly targetHeightM: number;
  /** AP kept in reserve for the inner "move + action" contour. */
  readonly actionReserveAp: number;
  /**
   * Largest difference of deck elevation (m) between neighbouring cells a unit can step: a
   * wall-walk is reached by its stairs, never from the foot of the wall.
   */
  readonly maxDeckStepM: number;
}

export interface UnitAttackRule {
  readonly type: DamageType;
  readonly power: number;
  /** 0 means melee (contact). */
  readonly rangeM: number;
  readonly accuracy: number;
}

export interface UnitTypeRule {
  readonly key: string;
  readonly name: string;
  readonly faction: Faction;
  readonly hp: number;
  readonly armor: ArmorClass;
  readonly attack: UnitAttackRule | null;
  readonly ap: number;
  readonly movement: MovementProfile;
  readonly tags: readonly string[];
}

export interface DamageRules {
  readonly armorReduction: Readonly<Record<ArmorClass, number>>;
  readonly multipliers: Readonly<Record<DamageType, Readonly<Record<ArmorClass, number>>>>;
  readonly critChance: number;
  readonly critMultiplier: number;
  readonly hitChanceMin: number;
  readonly hitChanceMax: number;
  readonly heightStepM: number;
  readonly accuracyPerHeightStep: number;
  readonly rangePerHeightStep: number;
  readonly coverPenalty: Readonly<Record<CoverLevel, number>>;
  readonly meleeReachM: number;
  /** AP spent by an attack (the "move + action" contour reserves the same amount). */
  readonly attackApCost: number;
  /** Attacks a unit may make per turn. */
  readonly actionsPerTurn: number;
  /** Accuracy factor of the defender's melee riposte. */
  readonly riposteAccuracyFactor: number;
  /** Hit-chance penalty per unit of foliage obscurance along the line of fire. */
  readonly obscurancePenalty: number;
  /** A hedge or dry-stone wall this close to the target, on the shooter's side, covers it (m). */
  readonly directionalCoverReachM: number;
  /** Damage of a landed blow never falls below this. */
  readonly minDamageOnHit: number;
  /** Overwatch cone half-angle (degrees) around the chosen direction. */
  readonly overwatchHalfAngleDeg: number;
  /** Accuracy factor of reaction shots. */
  readonly overwatchAccuracyFactor: number;
  /** Spacing (m) of the points where a moving unit is checked against overwatch cones. */
  readonly overwatchSampleM: number;
}

/** Morale (brief §9.7), 0 to max. */
export interface MoraleRules {
  readonly max: number;
  /** Below this a unit is shaken: it loses shakenApPenalty AP at the start of its turn. */
  readonly shakenBelow: number;
  readonly shakenApPenalty: number;
  /** Below this a unit flees: at the start of its turn it runs from the enemy on its own. */
  readonly fleeBelow: number;
  /** An ally dying within this radius (m) costs allyDeathLoss. */
  readonly allyDeathRadiusM: number;
  readonly allyDeathLoss: number;
  /** Falling below this fraction of max HP costs woundedLoss (once per crossing). */
  readonly woundedHpFraction: number;
  readonly woundedLoss: number;
  /** Morale gained for a kill. */
  readonly killGain: number;
  /** Morale regained at the start of each of the unit's turns. */
  readonly recoveryPerTurn: number;
}

/** How a battle is won and lost (J5). */
export interface BattleRules {
  /** The defenders hold out this many rounds: relief arrives and they win. */
  readonly turnLimit: number;
}

/** Fire (J4, brief §9.9). */
export interface FireRules {
  /** Rounds a cell burns: timber (bridges, fascines, gates), vegetation (fields, hedges). */
  readonly woodTurns: number;
  readonly vegetationTurns: number;
  /** Extra AP of a fire arrow; height (m) aimed at on the target cell. */
  readonly arrowExtraAp: number;
  readonly targetHeightM: number;
  /** A unit puts out a fire from this close (m). */
  readonly extinguishReachM: number;
  /** Damage a round on a burning cell, and within nearRadiusM of one (before the fire multiplier). */
  readonly burnDamage: number;
  readonly nearDamage: number;
  readonly nearRadiusM: number;
  readonly moraleLoss: number;
  /** Damage a round to a wooden gate under fire. */
  readonly structureDamage: number;
  /** Chance a round to catch a flammable neighbour, raised downwind (× wind strength), capped. */
  readonly spreadChance: number;
  readonly windSpread: number;
  readonly spreadMax: number;
}

/** Castle structures (J4, brief §9.8). */
export interface StructureRules {
  readonly wallHp: number;
  readonly gateHp: number;
  readonly portcullisHp: number;
  /** Extra hit chance against something as large as a wall or a gate. */
  readonly hitBonus: number;
  /** Damage taken by units on a wall-walk segment that collapses. */
  readonly fallDamage: number;
  /** Morale lost by defenders within the radius (m) of a collapsing segment. */
  readonly collapseMoraleLoss: number;
  readonly collapseMoraleRadiusM: number;
  /** Sappers: turns of work to fill a moat slot, to undermine a segment. */
  readonly fillTurns: number;
  readonly mineTurns: number;
  /** Moat slots along the centreline (m), and how far the causeway runs past the water (m). */
  readonly fillSlotM: number;
  readonly fillBankM: number;
  /** Siege tower: docking reach to a wall segment (m), AP of a climb, climbs a turn. */
  readonly towerDockReachM: number;
  readonly towerClimbAp: number;
  readonly towerCapacity: number;
}

/** Weather and time of day (J5, brief §9.11). */
export interface WeatherRules {
  /** Odds of each weather (they sum to 1). */
  readonly odds: Readonly<Record<'clear' | 'rain' | 'fog', number>>;
  /** Range of the drawn start hour, and hours a round lasts. */
  readonly startHour: readonly [number, number];
  /** A scenario that sets no hour starts at this one. */
  readonly defaultStartHour: number;
  readonly hoursPerRound: number;
  /** Night from this hour to that one. */
  readonly nightFrom: number;
  readonly nightTo: number;
  readonly rainAccuracyPenalty: number;
  /** Rain on fire: factors on a fire arrow's chance, a cell's fuel and the spread chance. */
  readonly rainFire: { readonly ignite: number; readonly fuel: number; readonly spread: number };
  /** Rain turns these layers to mud: their AP per metre × mudCost (per movement profile). */
  readonly muddyLayers: readonly TerrainLayerKey[];
  readonly mudCost: Readonly<Record<MovementProfile, number>>;
  /** Fog: shots and sight reach no farther (m). */
  readonly fogSightM: number;
  /** Night: range factor and hit penalty, except at targets within lightRadiusM of a torch. */
  readonly nightRangeFactor: number;
  readonly nightAccuracyPenalty: number;
  readonly lightRadiusM: number;
  /** Artillery's hit penalty in a full crosswind of strength 1. */
  readonly windArtilleryPenalty: number;
}

/** Heroes (J5, brief §9.5): what their abilities do is fixed by id, the figures are data. */
export const HERO_ABILITY_IDS = ['volley', 'piercingShot', 'calibrate', 'rushWorks', 'rally', 'heroicCharge'] as const;
export type HeroAbilityId = (typeof HERO_ABILITY_IDS)[number];
export const HERO_PASSIVE_IDS = ['eagleEye', 'masterBuilder', 'steadfast'] as const;
export type HeroPassiveId = (typeof HERO_PASSIVE_IDS)[number];
export const ABILITY_TARGETS = ['self', 'enemy', 'allyEngine', 'site'] as const;
export type AbilityTarget = (typeof ABILITY_TARGETS)[number];

export interface HeroAbilityRule {
  readonly id: HeroAbilityId;
  readonly name: string;
  readonly description: string;
  /** Own turns before it can be used again. */
  readonly cooldown: number;
  /** AP it costs (on top of the attack's for a blow). */
  readonly apCost: number;
  readonly target: AbilityTarget;
  readonly radiusM: number;
  readonly accuracyBonus: number;
  readonly damageFactor: number;
  readonly moraleGain: number;
  readonly workFactor: number;
}

export interface HeroPassiveRule {
  readonly id: HeroPassiveId;
  readonly name: string;
  readonly description: string;
  readonly radiusM: number;
  readonly accuracyBonus: number;
  readonly moraleLossFactor: number;
}

export interface HeroRule {
  /** The unit type the hero fights as. */
  readonly typeKey: string;
  readonly name: string;
  readonly title: string;
  readonly feminine: boolean;
  readonly personality: string;
  readonly abilities: readonly HeroAbilityRule[];
  readonly passive: HeroPassiveRule;
  /** Short lines in battle. */
  readonly lines: { readonly ability: readonly string[]; readonly kill: readonly string[]; readonly wounded: readonly string[] };
}

export interface GameRules {
  /** Indexed by TerrainLayerId. */
  readonly terrainLayers: readonly TerrainLayerRule[];
  readonly movement: MovementRules;
  readonly units: Readonly<Record<string, UnitTypeRule>>;
  readonly damage: DamageRules;
  readonly morale: MoraleRules;
  readonly structures: StructureRules;
  readonly fire: FireRules;
  readonly battle: BattleRules;
  readonly weather: WeatherRules;
  /** By unit type key. */
  readonly heroes: Readonly<Record<string, HeroRule>>;
}
