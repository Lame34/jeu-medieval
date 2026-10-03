/**
 * Dependency-free validation of the raw JSON rule files into typed, frozen GameRules.
 * Errors carry the JSON path so a broken data file is diagnosed at load time, not mid-battle.
 */
import {
  ARMOR_CLASSES,
  COVER_LEVELS,
  DAMAGE_TYPES,
  FACTIONS,
  MATERIALS,
  MOVEMENT_PROFILES,
  TERRAIN_LAYER_KEYS,
  TerrainLayer,
  type ArmorClass,
  type CoverLevel,
  type DamageRules,
  type DamageType,
  type GameRules,
  type MovementProfile,
  type MoraleRules,
  type StructureRules,
  type FireRules,
  type TerrainLayerKey,
  type WeatherRules,
  type HeroRule,
  type HeroAbilityRule,
  type HeroAbilityId,
  type HeroPassiveId,
  type AbilityTarget,
  HERO_ABILITY_IDS,
  HERO_PASSIVE_IDS,
  ABILITY_TARGETS,
  type MovementRules,
  type TerrainLayerRule,
  type UnitAttackRule,
  type UnitTypeRule,
} from './types.ts';

export class RulesValidationError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'RulesValidationError';
  }
}

type Json = Record<string, unknown>;

function obj(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesValidationError(path, 'expected an object');
  }
  return value as Json;
}

function num(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RulesValidationError(path, 'expected a finite number');
  if (value < min || value > max) throw new RulesValidationError(path, `expected a value in [${min}, ${max}], got ${value}`);
  return value;
}

function integer(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  const n = num(value, path, min, max);
  if (!Number.isInteger(n)) throw new RulesValidationError(path, `expected an integer, got ${n}`);
  return n;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new RulesValidationError(path, 'expected a boolean');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RulesValidationError(path, 'expected a non-empty string');
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new RulesValidationError(path, `expected one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function record<K extends string>(value: unknown, keys: readonly K[], path: string, read: (v: unknown, p: string) => number): Record<K, number> {
  const source = obj(value, path);
  const out = {} as Record<K, number>;
  for (const key of keys) out[key] = read(source[key], `${path}.${key}`);
  return out;
}

const PROBABILITY = [0, 1] as const;

function readTerrainLayers(raw: unknown): TerrainLayerRule[] {
  const layers = obj(raw, 'terrain.layers');
  const unknownKeys = Object.keys(layers).filter((k) => !(TERRAIN_LAYER_KEYS as string[]).includes(k));
  if (unknownKeys.length > 0) throw new RulesValidationError('terrain.layers', `unknown layer(s): ${unknownKeys.join(', ')}`);
  const out: TerrainLayerRule[] = [];
  for (const key of TERRAIN_LAYER_KEYS) {
    const path = `terrain.layers.${key}`;
    const layer = obj(layers[key], path);
    const sight = obj(layer['sight'], `${path}.sight`);
    const id = TerrainLayer[key];
    out[id] = Object.freeze({
      key,
      id,
      metersPerAp: Object.freeze(record(layer['metersPerAp'], MOVEMENT_PROFILES, `${path}.metersPerAp`, (v, p) => num(v, p, 0))),
      cover: oneOf<CoverLevel>(layer['cover'], COVER_LEVELS, `${path}.cover`),
      directionalCover: bool(layer['directionalCover'], `${path}.directionalCover`),
      flammable: bool(layer['flammable'], `${path}.flammable`),
      flatDeck: layer['flatDeck'] === undefined ? false : bool(layer['flatDeck'], `${path}.flatDeck`),
      material: oneOf(layer['material'], MATERIALS, `${path}.material`),
      sight: Object.freeze({
        heightM: num(sight['heightM'], `${path}.sight.heightM`, 0),
        densityPerM: num(sight['densityPerM'], `${path}.sight.densityPerM`, 0),
      }),
    });
  }
  return out;
}

function readMovement(raw: unknown): MovementRules {
  const m = obj(raw, 'terrain.movement');
  return Object.freeze({
    uphillPenaltyPerGrade: num(m['uphillPenaltyPerGrade'], 'terrain.movement.uphillPenaltyPerGrade', 0),
    maxWalkableGrade: Object.freeze(
      record<MovementProfile>(m['maxWalkableGrade'], MOVEMENT_PROFILES, 'terrain.movement.maxWalkableGrade', (v, p) => num(v, p, 0)),
    ),
    eyeHeightM: num(m['eyeHeightM'], 'terrain.movement.eyeHeightM', 0),
    targetHeightM: num(m['targetHeightM'], 'terrain.movement.targetHeightM', 0),
    actionReserveAp: num(m['actionReserveAp'], 'terrain.movement.actionReserveAp', 0),
    maxDeckStepM: num(m['maxDeckStepM'], 'terrain.movement.maxDeckStepM', 0),
  });
}

function readAttack(raw: unknown, path: string): UnitAttackRule | null {
  if (raw === null) return null;
  const a = obj(raw, path);
  return Object.freeze({
    type: oneOf<DamageType>(a['type'], DAMAGE_TYPES, `${path}.type`),
    power: num(a['power'], `${path}.power`, 0),
    rangeM: num(a['rangeM'], `${path}.rangeM`, 0),
    accuracy: num(a['accuracy'], `${path}.accuracy`, ...PROBABILITY),
  });
}

function readUnits(raw: unknown): Record<string, UnitTypeRule> {
  const units = obj(obj(raw, 'units')['units'], 'units.units');
  const out: Record<string, UnitTypeRule> = {};
  for (const [key, value] of Object.entries(units)) {
    const path = `units.${key}`;
    const u = obj(value, path);
    const tags = u['tags'];
    if (!Array.isArray(tags)) throw new RulesValidationError(`${path}.tags`, 'expected an array');
    out[key] = Object.freeze({
      key,
      name: str(u['name'], `${path}.name`),
      faction: oneOf(u['faction'], FACTIONS, `${path}.faction`),
      hp: num(u['hp'], `${path}.hp`, 1),
      armor: oneOf<ArmorClass>(u['armor'], ARMOR_CLASSES, `${path}.armor`),
      attack: readAttack(u['attack'], `${path}.attack`),
      ap: num(u['ap'], `${path}.ap`, 1),
      movement: oneOf<MovementProfile>(u['movement'], MOVEMENT_PROFILES, `${path}.movement`),
      tags: Object.freeze(tags.map((t, i) => str(t, `${path}.tags[${i}]`))),
    });
  }
  return out;
}

function readDamage(raw: unknown): DamageRules {
  const d = obj(raw, 'damage');
  const multipliersRaw = obj(d['multipliers'], 'damage.multipliers');
  const multipliers = {} as Record<DamageType, Readonly<Record<ArmorClass, number>>>;
  for (const type of DAMAGE_TYPES) {
    multipliers[type] = Object.freeze(record(multipliersRaw[type], ARMOR_CLASSES, `damage.multipliers.${type}`, (v, p) => num(v, p, 0)));
  }
  const hitChanceMin = num(d['hitChanceMin'], 'damage.hitChanceMin', ...PROBABILITY);
  const hitChanceMax = num(d['hitChanceMax'], 'damage.hitChanceMax', hitChanceMin, 1);
  return Object.freeze({
    armorReduction: Object.freeze(record(d['armorReduction'], ARMOR_CLASSES, 'damage.armorReduction', (v, p) => num(v, p, 0, 1))),
    multipliers: Object.freeze(multipliers),
    critChance: num(d['critChance'], 'damage.critChance', ...PROBABILITY),
    critMultiplier: num(d['critMultiplier'], 'damage.critMultiplier', 1),
    hitChanceMin,
    hitChanceMax,
    heightStepM: num(d['heightStepM'], 'damage.heightStepM', Number.MIN_VALUE),
    accuracyPerHeightStep: num(d['accuracyPerHeightStep'], 'damage.accuracyPerHeightStep', 0, 1),
    rangePerHeightStep: num(d['rangePerHeightStep'], 'damage.rangePerHeightStep', 0, 1),
    coverPenalty: Object.freeze(record(d['coverPenalty'], COVER_LEVELS, 'damage.coverPenalty', (v, p) => num(v, p, 0, 1))),
    meleeReachM: num(d['meleeReachM'], 'damage.meleeReachM', 0),
    attackApCost: integer(d['attackApCost'], 'damage.attackApCost', 0),
    actionsPerTurn: integer(d['actionsPerTurn'], 'damage.actionsPerTurn', 1),
    riposteAccuracyFactor: num(d['riposteAccuracyFactor'], 'damage.riposteAccuracyFactor', ...PROBABILITY),
    obscurancePenalty: num(d['obscurancePenalty'], 'damage.obscurancePenalty', ...PROBABILITY),
    directionalCoverReachM: num(d['directionalCoverReachM'], 'damage.directionalCoverReachM', 0),
    minDamageOnHit: integer(d['minDamageOnHit'], 'damage.minDamageOnHit', 0),
    overwatchHalfAngleDeg: num(d['overwatchHalfAngleDeg'], 'damage.overwatchHalfAngleDeg', 0, 180),
    overwatchAccuracyFactor: num(d['overwatchAccuracyFactor'], 'damage.overwatchAccuracyFactor', ...PROBABILITY),
    overwatchSampleM: num(d['overwatchSampleM'], 'damage.overwatchSampleM', Number.MIN_VALUE),
  });
}

function readMorale(raw: unknown): MoraleRules {
  const m = obj(raw, 'damage.morale');
  const max = num(m['max'], 'damage.morale.max', 1);
  const fleeBelow = num(m['fleeBelow'], 'damage.morale.fleeBelow', 0, max);
  return Object.freeze({
    max,
    shakenBelow: num(m['shakenBelow'], 'damage.morale.shakenBelow', fleeBelow, max),
    shakenApPenalty: integer(m['shakenApPenalty'], 'damage.morale.shakenApPenalty', 0),
    fleeBelow,
    allyDeathRadiusM: num(m['allyDeathRadiusM'], 'damage.morale.allyDeathRadiusM', 0),
    allyDeathLoss: num(m['allyDeathLoss'], 'damage.morale.allyDeathLoss', 0, max),
    woundedHpFraction: num(m['woundedHpFraction'], 'damage.morale.woundedHpFraction', ...PROBABILITY),
    woundedLoss: num(m['woundedLoss'], 'damage.morale.woundedLoss', 0, max),
    killGain: num(m['killGain'], 'damage.morale.killGain', 0, max),
    recoveryPerTurn: num(m['recoveryPerTurn'], 'damage.morale.recoveryPerTurn', 0, max),
  });
}

function readStructures(raw: unknown): StructureRules {
  const s = obj(raw, 'damage.structures');
  return Object.freeze({
    wallHp: num(s['wallHp'], 'damage.structures.wallHp', 1),
    gateHp: num(s['gateHp'], 'damage.structures.gateHp', 1),
    portcullisHp: num(s['portcullisHp'], 'damage.structures.portcullisHp', 1),
    hitBonus: num(s['hitBonus'], 'damage.structures.hitBonus', 0, 1),
    fallDamage: num(s['fallDamage'], 'damage.structures.fallDamage', 0),
    collapseMoraleLoss: num(s['collapseMoraleLoss'], 'damage.structures.collapseMoraleLoss', 0),
    collapseMoraleRadiusM: num(s['collapseMoraleRadiusM'], 'damage.structures.collapseMoraleRadiusM', 0),
    fillTurns: num(s['fillTurns'], 'damage.structures.fillTurns', 1),
    mineTurns: num(s['mineTurns'], 'damage.structures.mineTurns', 1),
    fillSlotM: num(s['fillSlotM'], 'damage.structures.fillSlotM', 1),
    fillBankM: num(s['fillBankM'], 'damage.structures.fillBankM', 0),
    towerDockReachM: num(s['towerDockReachM'], 'damage.structures.towerDockReachM', 0),
    towerClimbAp: num(s['towerClimbAp'], 'damage.structures.towerClimbAp', 0),
    towerCapacity: num(s['towerCapacity'], 'damage.structures.towerCapacity', 1),
  });
}

function readFire(raw: unknown): FireRules {
  const f = obj(raw, 'damage.fire');
  const n = (k: string, min?: number, max?: number) => num(f[k], `damage.fire.${k}`, min, max);
  return Object.freeze({
    woodTurns: n('woodTurns', 1),
    vegetationTurns: n('vegetationTurns', 1),
    arrowExtraAp: n('arrowExtraAp', 0),
    targetHeightM: n('targetHeightM', 0),
    extinguishReachM: n('extinguishReachM', 0),
    burnDamage: n('burnDamage', 0),
    nearDamage: n('nearDamage', 0),
    nearRadiusM: n('nearRadiusM', 0),
    moraleLoss: n('moraleLoss', 0),
    structureDamage: n('structureDamage', 0),
    spreadChance: n('spreadChance', 0, 1),
    windSpread: n('windSpread', 0, 1),
    spreadMax: n('spreadMax', 0, 1),
  });
}

function readWeather(raw: unknown): WeatherRules {
  const w = obj(raw, 'damage.weather');
  const n = (k: string, min?: number, max?: number) => num(w[k], `damage.weather.${k}`, min, max);
  const odds = record(w['odds'], ['clear', 'rain', 'fog'] as const, 'damage.weather.odds', (v, p) => num(v, p, 0, 1));
  const total = odds.clear + odds.rain + odds.fog;
  if (Math.abs(total - 1) > 1e-6) throw new RulesValidationError('damage.weather.odds', `must sum to 1 (got ${total})`);
  const hours = w['startHour'];
  if (!Array.isArray(hours) || hours.length !== 2) throw new RulesValidationError('damage.weather.startHour', 'expected [from, to]');
  const startHour: [number, number] = [num(hours[0], 'damage.weather.startHour[0]', 0, 24), num(hours[1], 'damage.weather.startHour[1]', 0, 24)];
  const rf = obj(w['rainFire'], 'damage.weather.rainFire');
  const layers = w['muddyLayers'];
  if (!Array.isArray(layers)) throw new RulesValidationError('damage.weather.muddyLayers', 'expected an array');
  const muddyLayers = layers.map((k, i) => {
    if (typeof k !== 'string' || !(TERRAIN_LAYER_KEYS as readonly string[]).includes(k)) throw new RulesValidationError(`damage.weather.muddyLayers[${i}]`, `unknown layer "${String(k)}"`);
    return k as TerrainLayerKey;
  });
  return Object.freeze({
    odds: Object.freeze(odds),
    startHour,
    defaultStartHour: n('defaultStartHour', 0, 24),
    hoursPerRound: n('hoursPerRound', 0, 24),
    nightFrom: n('nightFrom', 0, 24),
    nightTo: n('nightTo', 0, 24),
    rainAccuracyPenalty: n('rainAccuracyPenalty', 0, 1),
    rainFire: Object.freeze({ ignite: num(rf['ignite'], 'damage.weather.rainFire.ignite', 0, 1), fuel: num(rf['fuel'], 'damage.weather.rainFire.fuel', 0, 1), spread: num(rf['spread'], 'damage.weather.rainFire.spread', 0, 1) }),
    muddyLayers: Object.freeze(muddyLayers),
    mudCost: Object.freeze(record(w['mudCost'], MOVEMENT_PROFILES, 'damage.weather.mudCost', (v, p) => num(v, p, 1))),
    fogSightM: n('fogSightM', 1),
    nightRangeFactor: n('nightRangeFactor', 0, 1),
    nightAccuracyPenalty: n('nightAccuracyPenalty', 0, 1),
    lightRadiusM: n('lightRadiusM', 0),
    windArtilleryPenalty: n('windArtilleryPenalty', 0, 1),
  });
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new RulesValidationError(path, 'expected an array of strings');
  return value as string[];
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RulesValidationError(path, 'expected a non-empty string');
  return value;
}

function readHeroes(raw: unknown, units: Readonly<Record<string, UnitTypeRule>>): Record<string, HeroRule> {
  if (raw === undefined) return {};
  const heroes = obj(obj(raw, 'heroes')['heroes'], 'heroes.heroes');
  const out: Record<string, HeroRule> = {};
  for (const [typeKey, value] of Object.entries(heroes)) {
    const path = `heroes.heroes.${typeKey}`;
    const h = obj(value, path);
    const unit = units[typeKey];
    if (!unit) throw new RulesValidationError(path, `no unit type "${typeKey}"`);
    if (!unit.tags.includes('hero')) throw new RulesValidationError(path, `unit type "${typeKey}" lacks the "hero" tag`);
    const rawAbilities = h['abilities'];
    if (!Array.isArray(rawAbilities) || rawAbilities.length !== 2) throw new RulesValidationError(`${path}.abilities`, 'expected two abilities');
    const abilities = rawAbilities.map((a, i): HeroAbilityRule => {
      const p = `${path}.abilities[${i}]`;
      const r = obj(a, p);
      const opt = (k: string, fallback: number, min = 0, max = Infinity) => (r[k] === undefined ? fallback : num(r[k], `${p}.${k}`, min, max));
      return Object.freeze({
        id: oneOf<HeroAbilityId>(r['id'], HERO_ABILITY_IDS, `${p}.id`),
        name: text(r['name'], `${p}.name`),
        description: text(r['description'], `${p}.description`),
        cooldown: num(r['cooldown'], `${p}.cooldown`, 0),
        apCost: num(r['apCost'], `${p}.apCost`, 0),
        target: oneOf<AbilityTarget>(r['target'], ABILITY_TARGETS, `${p}.target`),
        radiusM: opt('radiusM', 0),
        accuracyBonus: opt('accuracyBonus', 0, 0, 1),
        damageFactor: opt('damageFactor', 1, 0),
        moraleGain: opt('moraleGain', 0),
        workFactor: opt('workFactor', 1, 1),
      });
    });
    const pr = obj(h['passive'], `${path}.passive`);
    const popt = (k: string, fallback: number, min = 0, max = Infinity) => (pr[k] === undefined ? fallback : num(pr[k], `${path}.passive.${k}`, min, max));
    const lines = obj(h['lines'], `${path}.lines`);
    out[typeKey] = Object.freeze({
      typeKey,
      name: text(h['name'], `${path}.name`),
      title: text(h['title'], `${path}.title`),
      feminine: h['feminine'] === true,
      personality: text(h['personality'], `${path}.personality`),
      abilities: Object.freeze(abilities),
      passive: Object.freeze({
        id: oneOf<HeroPassiveId>(pr['id'], HERO_PASSIVE_IDS, `${path}.passive.id`),
        name: text(pr['name'], `${path}.passive.name`),
        description: text(pr['description'], `${path}.passive.description`),
        radiusM: popt('radiusM', 0),
        accuracyBonus: popt('accuracyBonus', 0, 0, 1),
        moraleLossFactor: popt('moraleLossFactor', 1, 0, 1),
      }),
      lines: Object.freeze({ ability: strings(lines['ability'], `${path}.lines.ability`), kill: strings(lines['kill'], `${path}.lines.kill`), wounded: strings(lines['wounded'], `${path}.lines.wounded`) }),
    });
  }
  return out;
}

export interface RawRuleFiles {
  readonly terrain: unknown;
  readonly units: unknown;
  readonly damage: unknown;
  /** Heroes (J5); none when absent. */
  readonly heroes?: unknown;
}

export function validateRules(raw: RawRuleFiles): GameRules {
  const terrain = obj(raw.terrain, 'terrain');
  const units = Object.freeze(readUnits(raw.units));
  return Object.freeze({
    terrainLayers: Object.freeze(readTerrainLayers(terrain['layers'])),
    movement: readMovement(terrain['movement']),
    units,
    heroes: Object.freeze(readHeroes(raw.heroes, units)),
    damage: readDamage(raw.damage),
    morale: readMorale(obj(raw.damage, 'damage')['morale']),
    structures: readStructures(obj(raw.damage, 'damage')['structures']),
    fire: readFire(obj(raw.damage, 'damage')['fire']),
    battle: Object.freeze({ turnLimit: num(obj(obj(raw.damage, 'damage')['battle'], 'damage.battle')['turnLimit'], 'damage.battle.turnLimit', 1) }),
    weather: readWeather(obj(raw.damage, 'damage')['weather']),
  });
}
