/**
 * Weather and time of day (J5, brief §9.11). The start hour and the weather are drawn from the
 * seed (or fixed by the scenario); the hour advances each round. They shape the battle:
 * - rain: −10 % accuracy for shots, fire weakened (fire arrows catch less, fires burn shorter and
 *   spread less), mud (the open ground is slower);
 * - fog: shots and sight reach no farther than `fogSightM`; each side only knows the enemies its
 *   men can see (the AI does not cheat, brief §9.6);
 * - night: ranges −30 % and a penalty to hit, except at targets standing in the light of the
 *   castle's torches and the village's braziers;
 * - wind: artillery (indirect fire) loses accuracy in a crosswind.
 * Every modifier of a shot is listed (the HUD shows them in the preview).
 */
import type { MovementProfile, TerrainLayerRule, GameRules } from '../rules/types.ts';
import { Rng, type Seed } from '../rng.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import type { BattleContext } from './context.ts';
import { auraAccuracy } from './hero-auras.ts';
import type { BattleState, Scenario, UnitState } from './types.ts';
import type { WorldLayout } from '../worldgen/types.ts';

export type Weather = 'clear' | 'rain' | 'fog';
export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'fog'];

/** The ground under the weather: open ground turns to mud in the rain. */
export type GroundCondition = 'dry' | 'mud';

/** One modifier of a shot, for the preview's tooltip. */
export interface ShotModifier {
  readonly kind: 'rain' | 'fog' | 'night' | 'wind' | 'hero' | 'aim';
  /** For a hero's: the ability or passive behind it. */
  readonly source?: string;
  /** Added to the hit chance (negative: a penalty). */
  readonly accuracy: number;
  /** Multiplies the range (1: none). */
  readonly rangeFactor: number;
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

/** A scenario's conditions: clear at the default hour unless it sets them. */
export function conditionsOf(rules: GameRules, scenario: Scenario): BattleConditions {
  return { weather: scenario.weather ?? 'clear', startHour: scenario.startHour ?? rules.weather.defaultStartHour };
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
    modifiers.push({ kind: 'fog', accuracy: 0, rangeFactor: 1 });
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

/** How far a unit sees (fog of war under fog; no limit otherwise). */
export function sightRangeM(ctx: BattleContext, state: BattleState): number {
  return state.weather === 'fog' ? ctx.rules.weather.fogSightM : Number.POSITIVE_INFINITY;
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

/** Fire under the weather: factors on a fire arrow's chance, a cell's fuel and the spread. */
export function fireFactors(rules: GameRules, weather: Weather): { ignite: number; fuel: number; spread: number } {
  if (weather !== 'rain') return { ignite: 1, fuel: 1, spread: 1 };
  return rules.weather.rainFire;
}

export function groundOf(weather: Weather): GroundCondition {
  return weather === 'rain' ? 'mud' : 'dry';
}

const muddyRulesCache = new WeakMap<GameRules, GameRules>();

/** The rules the nav grid is built with on `ground`: in mud, the open ground costs more AP a metre. */
export function rulesOnGround(rules: GameRules, ground: GroundCondition): GameRules {
  if (ground === 'dry') return rules;
  const cached = muddyRulesCache.get(rules);
  if (cached) return cached;
  const w = rules.weather;
  const muddy = new Set(w.muddyLayers);
  const terrainLayers = rules.terrainLayers.map((l): TerrainLayerRule => {
    if (!muddy.has(l.key)) return l;
    const metersPerAp = {} as Record<MovementProfile, number>;
    for (const [profile, m] of Object.entries(l.metersPerAp) as [MovementProfile, number][]) metersPerAp[profile] = m / w.mudCost[profile];
    return { ...l, metersPerAp };
  });
  const out = { ...rules, terrainLayers };
  muddyRulesCache.set(rules, out);
  return out;
}

/** Torches and braziers of a map: the castle's gates, towers and keeps, and every house of the village. */
export function lightsOf(layout: WorldLayout): Vec2[] {
  return [...layout.gates.map((g) => g.center), ...layout.towers.map((t) => t.center), ...layout.keeps.map((k) => k.center), ...layout.houses.map((h) => h.center)];
}
