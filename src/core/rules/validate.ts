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

export interface RawRuleFiles {
  readonly terrain: unknown;
  readonly units: unknown;
  readonly damage: unknown;
}

export function validateRules(raw: RawRuleFiles): GameRules {
  const terrain = obj(raw.terrain, 'terrain');
  return Object.freeze({
    terrainLayers: Object.freeze(readTerrainLayers(terrain['layers'])),
    movement: readMovement(terrain['movement']),
    units: Object.freeze(readUnits(raw.units)),
    damage: readDamage(raw.damage),
    morale: readMorale(obj(raw.damage, 'damage')['morale']),
  });
}
