/**
 * Weather and time of day (J5, brief §9.11). The start hour and the weather are drawn from the
 * seed (or fixed by the scenario); the hour advances each round. They shape the battle:
 * - rain: −10 % accuracy for shots, fire weakened (fire arrows catch less, fires burn shorter and
 *   spread less), mud (the open ground is slower);
 * - fog: shots and sight reach no farther than `fogSightM`; each side only knows the enemies its
 *   men can see (the AI does not cheat, brief §9.6);
 * - night: ranges −30 % and a penalty to hit, except at targets standing in the light of the
 *   castle's torches and the village's braziers;
 * - wind: artillery (indirect fire) loses accuracy in a crosswind;
 * - the season of a campaign siege (ADR-052): April's soaked ground is mud, July's dry crops
 *   catch fire better, October's morning mist limits sight and shots until it lifts, and its
 *   harvested fields are stubble, which hides no one.
 * Every modifier of a shot is listed (the HUD shows them in the preview).
 */
import type { FireFactors, MovementProfile, SeasonRule, TerrainLayerKey, TerrainLayerRule, GameRules } from '../rules/types.ts';
import { Rng, type Seed } from '../rng.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import type { BattleContext } from './context.ts';
import { auraAccuracy } from './hero-auras.ts';
import type { BattleState, Scenario, UnitState } from './types.ts';
import type { WorldLayout } from '../worldgen/types.ts';

export type Weather = 'clear' | 'rain' | 'fog';
export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'fog'];

/**
 * The ground under the weather and the season: open ground turns to mud in the rain and in a
 * soaked month; the harvested fields are stubble (ADR-052); both in an autumn rain.
 */
export type GroundCondition = 'dry' | 'mud' | 'stubble' | 'mudStubble';

/** One modifier of a shot, for the preview's tooltip. */
export interface ShotModifier {
  readonly kind: 'rain' | 'fog' | 'mist' | 'night' | 'wind' | 'hero' | 'aim';
  /** For a hero's: the ability or passive behind it. */
  readonly source?: string;
  /** Added to the hit chance (negative: a penalty). */
  readonly accuracy: number;
  /** Multiplies the range (1: none). */
  readonly rangeFactor: number;
  /** Fog and mist: shots reach no farther than this (m). */
  readonly limitM?: number;
}

export interface ShotConditions {
  readonly accuracy: number;
  readonly rangeFactor: number;
  /** Shots reach no farther than this (fog); Infinity otherwise. */
  readonly maxRangeM: number;
  readonly modifiers: readonly ShotModifier[];
}

export const NO_CONDITIONS: ShotConditions = { accuracy: 0, rangeFactor: 1, maxRangeM: Number.POSITIVE_INFINITY, modifiers: [] };

export interface BattleConditions {
  readonly weather: Weather;
  readonly startHour: number;
  /** A campaign siege's month (ADR-052): an id of rules.weather.seasons; none in a skirmish. */
  readonly season?: string;
}

const WEATHER_RNG_LABEL = 'weather';

/**
 * Start hour and weather drawn from the seed (a game's battle writes them into its scenario, so
 * the replay keeps them).
 */
export function drawConditions(rules: GameRules, seed: Seed): BattleConditions {
  const w = rules.weather;
  const rng = Rng.create(seed).fork(WEATHER_RNG_LABEL);
  const roll = rng.next();
  let weather: Weather = 'clear';
  let acc = 0;
  for (const kind of WEATHERS) {
    acc += w.odds[kind];
    if (roll < acc) {
      weather = kind;
      break;
    }
  }
  const hourRoll = rng.next();
  // Quarter hours: a readable clock, the same on every machine.
  const startHour = Math.round((w.startHour[0] + hourRoll * (w.startHour[1] - w.startHour[0])) * 4) / 4;
  return { weather, startHour };
}

/** A scenario's conditions: clear at the default hour, in no season, unless it sets them. */
export function conditionsOf(rules: GameRules, scenario: Scenario): BattleConditions {
  if (scenario.season !== undefined && !Object.hasOwn(rules.weather.seasons, scenario.season)) throw new Error(`unknown season "${scenario.season}"`);
  return { weather: scenario.weather ?? 'clear', startHour: scenario.startHour ?? rules.weather.defaultStartHour, ...(scenario.season !== undefined ? { season: scenario.season } : {}) };
}

/** The battle's month (ADR-052), or null outside the campaign. */
export function seasonOf(rules: GameRules, state: Pick<BattleState, 'season'>): SeasonRule | null {
  return state.season === undefined ? null : (rules.weather.seasons[state.season] ?? null);
}

/**
 * A round's hour is a sum of fractions of an hour (0.3333 a round), a little short of the true
 * figure: the mist that lifts "at 10 h" is gone in the round the clock shows 10 h.
 */
const HOUR_EPSILON = 0.01;

/** How far one sees in the season's morning mist during this round; null without one, or once it lifted. */
export function mistSightM(rules: GameRules, state: Pick<BattleState, 'season' | 'startHour' | 'turn'>): number | null {
  const mist = seasonOf(rules, state)?.mist;
  if (!mist) return null;
  return hourOf(rules, state) < mist.untilHour - HOUR_EPSILON ? mist.sightM : null;
}

/** The hour (0–24) during round `turn`. */
export function hourOf(rules: GameRules, state: Pick<BattleState, 'startHour' | 'turn'>): number {
  const h = state.startHour + (state.turn - 1) * rules.weather.hoursPerRound;
  return ((h % 24) + 24) % 24;
}

export function isNight(rules: GameRules, hour: number): boolean {
  const { nightFrom, nightTo } = rules.weather;
  return hour >= nightFrom || hour < nightTo;
}

/** Is `p` within the light of a torch or a brazier? */
export function isLit(ctx: BattleContext, p: Vec2): boolean {
  const r = ctx.rules.weather.lightRadiusM;
  for (const l of ctx.lights) if (distance(l, p) <= r) return true;
  return false;
}

/** The skill at arms of the shooter's side (the player's rank), as a modifier; null when it has none. */
export function aimModifier(state: BattleState, shooter: UnitState): ShotModifier | null {
  const aim = state.aim?.[shooter.faction] ?? 0;
  return aim === 0 ? null : { kind: 'aim', accuracy: aim, rangeFactor: 1 };
}

/** A blow's conditions (no weather, no night at arm's length): the side's skill at arms alone. */
export function meleeConditions(state: BattleState, striker: UnitState): ShotConditions {
  const aim = aimModifier(state, striker);
  return aim ? { ...NO_CONDITIONS, accuracy: aim.accuracy, modifiers: [aim] } : NO_CONDITIONS;
}

/** The conditions of a shot from `from` at `to`; `artillery` for indirect fire (the wind deflects it). */
export function shotConditions(ctx: BattleContext, state: BattleState, from: Vec2, to: Vec2, artillery: boolean, shooter?: UnitState): ShotConditions {
  const w = ctx.rules.weather;
  const modifiers: ShotModifier[] = [];
  // The heroes' help: a buff on the shooter (volley, calibration), an aura around it.
  const windImmune = shooter?.buffs?.some((b) => b.windImmune) ?? false;
  for (const b of shooter?.buffs ?? []) if (b.accuracy !== 0) modifiers.push({ kind: 'hero', source: b.source, accuracy: b.accuracy, rangeFactor: 1 });
  const aura = shooter ? auraAccuracy(ctx, state.units, shooter) : null;
  if (aura) modifiers.push({ kind: 'hero', source: aura.id, accuracy: aura.accuracy, rangeFactor: 1 });
  const aim = shooter ? aimModifier(state, shooter) : null;
  if (aim) modifiers.push(aim);
  let maxRangeM = Number.POSITIVE_INFINITY;
  if (state.weather === 'rain') modifiers.push({ kind: 'rain', accuracy: -w.rainAccuracyPenalty, rangeFactor: 1 });
  if (state.weather === 'fog') {
    maxRangeM = w.fogSightM;
    modifiers.push({ kind: 'fog', accuracy: 0, rangeFactor: 1, limitM: w.fogSightM });
  }
  const mist = mistSightM(ctx.rules, state);
  if (mist !== null && mist < maxRangeM) {
    maxRangeM = mist;
    modifiers.push({ kind: 'mist', accuracy: 0, rangeFactor: 1, limitM: mist });
  }
  if (isNight(ctx.rules, hourOf(ctx.rules, state)) && !isLit(ctx, to)) modifiers.push({ kind: 'night', accuracy: -w.nightAccuracyPenalty, rangeFactor: w.nightRangeFactor });
  if (artillery && !windImmune && state.wind.strength > 0) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    const wl = Math.hypot(state.wind.x, state.wind.z);
    if (len > 0 && wl > 0) {
      // Crosswind: |sin| of the angle between the shot and the wind.
      const cross = Math.abs((dx * state.wind.z - dz * state.wind.x) / (len * wl));
      const penalty = w.windArtilleryPenalty * state.wind.strength * cross;
      if (penalty > 0) modifiers.push({ kind: 'wind', accuracy: -penalty, rangeFactor: 1 });
    }
  }
  return {
    accuracy: modifiers.reduce((s, m) => s + m.accuracy, 0),
    rangeFactor: modifiers.reduce((s, m) => s * m.rangeFactor, 1),
    maxRangeM,
    modifiers,
  };
}

/** A shot's reach under its conditions. */
export function conditionedRange(rangeM: number, c: ShotConditions): number {
  return Math.min(rangeM * c.rangeFactor, c.maxRangeM);
}

/** How far a unit sees (fog of war under fog or a morning mist; no limit otherwise). */
export function sightRangeM(ctx: BattleContext, state: BattleState): number {
  const fog = state.weather === 'fog' ? ctx.rules.weather.fogSightM : Number.POSITIVE_INFINITY;
  return Math.min(fog, mistSightM(ctx.rules, state) ?? Number.POSITIVE_INFINITY);
}

/**
 * What `faction` knows of the battle: under fog, the enemies none of its men can see are left
 * out (the AI decides on this, then its orders play out on the real state).
 */
export function perceivedState(ctx: BattleContext, state: BattleState, faction: BattleState['activeFaction']): BattleState {
  const sight = sightRangeM(ctx, state);
  if (!Number.isFinite(sight)) return state;
  const eyes = state.units.filter((u) => u.alive && u.faction === faction);
  const units = state.units.filter((u) => u.faction === faction || !u.alive || eyes.some((e) => distance(e.position, u.position) <= sight));
  return units.length === state.units.length ? state : { ...state, units };
}

/** Is `unit` seen by `faction` (fog of war)? */
export function isSeenBy(ctx: BattleContext, state: BattleState, faction: BattleState['activeFaction'], p: Vec2): boolean {
  const sight = sightRangeM(ctx, state);
  if (!Number.isFinite(sight)) return true;
  return state.units.some((u) => u.alive && u.faction === faction && distance(u.position, p) <= sight);
}

const NO_FIRE_CHANGE: FireFactors = { ignite: 1, fuel: 1, spread: 1 };

/** Fire under the weather and the season: factors on a fire arrow's chance, a cell's fuel and the spread. */
export function fireFactors(rules: GameRules, state: Pick<BattleState, 'weather' | 'season'>): FireFactors {
  const rain = state.weather === 'rain' ? rules.weather.rainFire : null;
  const season = seasonOf(rules, state)?.fire ?? null;
  if (!season) return rain ?? NO_FIRE_CHANGE;
  if (!rain) return season;
  return { ignite: rain.ignite * season.ignite, fuel: rain.fuel * season.fuel, spread: rain.spread * season.spread };
}

/** The ground under the weather and the season: mud in the rain and in a soaked month; stubble once the fields are harvested. */
export function groundOf(rules: GameRules, state: Pick<BattleState, 'weather' | 'season'>): GroundCondition {
  const season = seasonOf(rules, state);
  const mud = state.weather === 'rain' || season?.mud === true;
  const stubble = season?.stubble === true;
  return mud ? (stubble ? 'mudStubble' : 'mud') : stubble ? 'stubble' : 'dry';
}

/** The crops' layer: harvested, its fields are stubble. */
const CROP_LAYER: TerrainLayerKey = 'Field';
/** Stubble stands a hand high: it blocks no sight. */
const STUBBLE_SIGHT: TerrainLayerRule['sight'] = { heightM: 0, densityPerM: 0 };

const groundRulesCache = new WeakMap<GameRules, Map<GroundCondition, GameRules>>();

/**
 * The rules the nav grid is built with on `ground`: in mud, the open ground costs more AP a
 * metre; on stubble, a field gives no cover and blocks no sight (it still burns).
 */
export function rulesOnGround(rules: GameRules, ground: GroundCondition): GameRules {
  if (ground === 'dry') return rules;
  let byGround = groundRulesCache.get(rules);
  if (!byGround) {
    byGround = new Map();
    groundRulesCache.set(rules, byGround);
  }
  const cached = byGround.get(ground);
  if (cached) return cached;
  const w = rules.weather;
  const muddy = new Set(ground === 'mud' || ground === 'mudStubble' ? w.muddyLayers : []);
  const stubble = ground === 'stubble' || ground === 'mudStubble';
  const terrainLayers = rules.terrainLayers.map((l): TerrainLayerRule => {
    let out = l;
    if (muddy.has(l.key)) {
      const metersPerAp = {} as Record<MovementProfile, number>;
      for (const [profile, m] of Object.entries(l.metersPerAp) as [MovementProfile, number][]) metersPerAp[profile] = m / w.mudCost[profile];
      out = { ...out, metersPerAp };
    }
    if (stubble && l.key === CROP_LAYER) out = { ...out, cover: 'none', sight: STUBBLE_SIGHT };
    return out;
  });
  const out = { ...rules, terrainLayers };
  byGround.set(ground, out);
  return out;
}

/** Torches and braziers of a map: the castle's gates, towers and keeps, and every house of the village. */
export function lightsOf(layout: WorldLayout): Vec2[] {
  return [...layout.gates.map((g) => g.center), ...layout.towers.map((t) => t.center), ...layout.keeps.map((k) => k.center), ...layout.houses.map((h) => h.center)];
}
