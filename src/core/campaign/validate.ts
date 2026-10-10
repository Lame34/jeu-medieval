/** Validation of the raw campaign JSON against the rules (unit types, heroes, factions). */
import { WEATHERS, type Weather } from '../battle/conditions.ts';
import type { StructureKind } from '../battle/structures.ts';
import { integer, num, obj, oneOf, RulesValidationError, str, strings, type Json } from '../rules/json.ts';
import type { Faction, GameRules } from '../rules/types.ts';
import { GARRISON_GROUPS, type GarrisonGroup } from '../worldgen/garrison.ts';
import { VIGNETTES, type BattleEffects, type CampaignBattle, type CampaignData, type CampaignLevel, type CastleIndex, type GarrisonCut, type HeroCampaignLines, type Reinforcement, type Stratagem, type StructureEffect, type Vignette } from './types.ts';

const STRUCTURE_KINDS: readonly StructureKind[] = ['wall', 'gate', 'portcullis', 'drawbridge'];
const FACTION_KEYS: readonly Faction[] = ['attacker', 'defender'];
/** The worldgen's castle sizes. */
const CASTLE_INDEX = [1, 4] as const;
const DIFFICULTY = [1, 5] as const;
const MAX_TURN_DELTA = 6;
const MAX_MORALE_DELTA = 40;
const MAX_UNITS = 6;

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new RulesValidationError(path, 'expected an array');
  return value;
}

function optional<T>(source: Json, key: string, read: (v: unknown, p: string) => T, path: string): T | undefined {
  return source[key] === undefined ? undefined : read(source[key], `${path}.${key}`);
}

function unitOf(rules: GameRules, typeKey: string, faction: Faction, path: string): string {
  const type = rules.units[typeKey];
  if (!type) throw new RulesValidationError(path, `unknown unit type "${typeKey}"`);
  if (type.faction !== faction) throw new RulesValidationError(path, `"${typeKey}" is not a ${faction} unit`);
  return typeKey;
}

function readEffects(raw: unknown, rules: GameRules, path: string): BattleEffects {
  const e = obj(raw, path);
  const cut = optional(e, 'cut', (v, p) =>
    list(v, p).map((c, i): GarrisonCut => {
      const q = `${p}[${i}]`;
      const o = obj(c, q);
      const group = optional(o, 'group', (g, gp) => oneOf<GarrisonGroup>(g, GARRISON_GROUPS, gp), q);
      const typeKey = optional(o, 'typeKey', (t, tp) => unitOf(rules, str(t, tp), 'defender', tp), q);
      return { ...(group ? { group } : {}), ...(typeKey ? { typeKey } : {}), count: integer(o['count'], `${q}.count`, 1, MAX_UNITS) };
    }),
  path);
  const reinforce = optional(e, 'reinforce', (v, p) =>
    list(v, p).map((r, i): Reinforcement => {
      const q = `${p}[${i}]`;
      const o = obj(r, q);
      return { typeKey: unitOf(rules, str(o['typeKey'], `${q}.typeKey`), 'attacker', `${q}.typeKey`), count: integer(o['count'], `${q}.count`, 1, MAX_UNITS) };
    }),
  path);
  const structures = optional(e, 'structures', (v, p) =>
    list(v, p).map((s, i): StructureEffect => {
      const q = `${p}[${i}]`;
      const o = obj(s, q);
      const hpFraction = optional(o, 'hpFraction', (h, hp) => num(h, hp, 0.05, 1), q);
      const broken = o['broken'] === undefined ? undefined : o['broken'] === true;
      if (hpFraction === undefined && !broken) throw new RulesValidationError(q, 'expected hpFraction or broken: true');
      return { kind: oneOf<StructureKind>(o['kind'], STRUCTURE_KINDS, `${q}.kind`), ...(hpFraction !== undefined ? { hpFraction } : {}), ...(broken ? { broken } : {}) };
    }),
  path);
  const morale = optional(e, 'morale', (v, p) => {
    const o = obj(v, p);
    const out: Partial<Record<Faction, number>> = {};
    for (const key of Object.keys(o)) out[oneOf<Faction>(key, FACTION_KEYS, `${p}.${key}`)] = integer(o[key], `${p}.${key}`, -MAX_MORALE_DELTA, MAX_MORALE_DELTA);
    return out;
  }, path);
  const out: BattleEffects = {
    ...(e['weather'] !== undefined ? { weather: oneOf<Weather>(e['weather'], WEATHERS, `${path}.weather`) } : {}),
    ...(e['startHour'] !== undefined ? { startHour: num(e['startHour'], `${path}.startHour`, 0, 24) } : {}),
    ...(e['turnLimit'] !== undefined ? { turnLimit: integer(e['turnLimit'], `${path}.turnLimit`, 6, 60) } : {}),
    ...(e['turnDelta'] !== undefined ? { turnDelta: integer(e['turnDelta'], `${path}.turnDelta`, -MAX_TURN_DELTA, MAX_TURN_DELTA) } : {}),
    ...(morale ? { morale } : {}),
    ...(cut ? { cut } : {}),
    ...(reinforce ? { reinforce } : {}),
    ...(structures ? { structures } : {}),
    ...(e['fillMoat'] !== undefined ? { fillMoat: integer(e['fillMoat'], `${path}.fillMoat`, 1, 4) } : {}),
  };
  return Object.freeze(out);
}

function readBattle(raw: unknown, rules: GameRules, path: string): CampaignBattle {
  const b = obj(raw, path);
  const map = obj(b['map'], `${path}.map`);
  return {
    id: str(b['id'], `${path}.id`),
    name: str(b['name'], `${path}.name`),
    epithet: str(b['epithet'], `${path}.epithet`),
    lord: str(b['lord'], `${path}.lord`),
    lordLine: str(b['lordLine'], `${path}.lordLine`),
    intro: str(b['intro'], `${path}.intro`),
    victory: str(b['victory'], `${path}.victory`),
    defeat: str(b['defeat'], `${path}.defeat`),
    seed: str(b['seed'], `${path}.seed`),
    castleIndex: integer(b['castleIndex'], `${path}.castleIndex`, CASTLE_INDEX[0], CASTLE_INDEX[1]) as CastleIndex,
    vignette: oneOf<Vignette>(b['vignette'], VIGNETTES, `${path}.vignette`),
    map: { x: num(map['x'], `${path}.map.x`, 0, 1), y: num(map['y'], `${path}.map.y`, 0, 1) },
    difficulty: integer(b['difficulty'], `${path}.difficulty`, DIFFICULTY[0], DIFFICULTY[1]),
    battle: readEffects(b['battle'] ?? {}, rules, `${path}.battle`),
  };
}

function readStratagem(raw: unknown, rules: GameRules, path: string): Stratagem {
  const s = obj(raw, path);
  const hero = str(s['hero'], `${path}.hero`);
  if (!rules.heroes[hero]) throw new RulesValidationError(`${path}.hero`, `unknown hero "${hero}"`);
  return { id: str(s['id'], `${path}.id`), hero, name: str(s['name'], `${path}.name`), pitch: str(s['pitch'], `${path}.pitch`), effects: readEffects(s['effects'], rules, `${path}.effects`) };
}

function readLevel(raw: unknown, rules: GameRules, path: string): CampaignLevel {
  const battle = readBattle(raw, rules, path);
  const stratagems = list(obj(raw, path)['stratagems'], `${path}.stratagems`).map((s, i) => readStratagem(s, rules, `${path}.stratagems[${i}]`));
  const heroes = Object.keys(rules.heroes);
  // One plan per hero: the council hears each of them.
  if (stratagems.length !== heroes.length || heroes.some((h) => !stratagems.some((s) => s.hero === h))) {
    throw new RulesValidationError(`${path}.stratagems`, `expected one stratagem per hero (${heroes.join(', ')})`);
  }
  if (new Set(stratagems.map((s) => s.id)).size !== stratagems.length) throw new RulesValidationError(`${path}.stratagems`, 'duplicate stratagem id');
  return { ...battle, stratagems };
}

function readHeroLines(raw: unknown, rules: GameRules): Record<string, HeroCampaignLines> {
  const o = obj(raw, 'heroLines');
  const out: Record<string, HeroCampaignLines> = {};
  for (const hero of Object.keys(rules.heroes)) {
    const h = obj(o[hero], `heroLines.${hero}`);
    const lines = (key: string) => {
      const l = strings(h[key], `heroLines.${hero}.${key}`);
      if (l.length === 0) throw new RulesValidationError(`heroLines.${hero}.${key}`, 'expected at least one line');
      return l;
    };
    out[hero] = { victory: lines('victory'), defeat: lines('defeat'), resting: str(h['resting'], `heroLines.${hero}.resting`) };
  }
  return out;
}

/** The campaign, checked against the rules; throws RulesValidationError with the JSON path. */
export function validateCampaign(raw: unknown, rules: GameRules): CampaignData {
  const c = obj(raw, 'campaign');
  const levels = list(c['levels'], 'levels').map((l, i) => readLevel(l, rules, `levels[${i}]`));
  const tutorial = readBattle(c['tutorial'], rules, 'tutorial');
  const ids = [tutorial.id, ...levels.map((l) => l.id)];
  if (new Set(ids).size !== ids.length) throw new RulesValidationError('levels', 'duplicate battle id');
  const banners = obj(c['banners'], 'banners');
  return Object.freeze({
    realm: str(c['realm'], 'realm'),
    prologue: str(c['prologue'], 'prologue'),
    epilogue: str(c['epilogue'], 'epilogue'),
    tutorial,
    levels,
    banners: { swiftShare: num(banners['swiftShare'], 'banners.swiftShare', 0.1, 1), maxLosses: integer(banners['maxLosses'], 'banners.maxLosses', 0) },
    heroLines: readHeroLines(c['heroLines'], rules),
  });
}
