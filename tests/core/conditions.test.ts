/**
 * Weather and time of day (ADR-031, src/core/battle/conditions.ts): the seeded draw, the clock,
 * the modifiers of a shot, their use by the previews (combat, fire), the mud, the fog of war and
 * the AI's perception, and the torches of a generated map.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  TerrainLayer,
  applyCommand,
  createBattle,
  createBattleContext,
  createTerrainData,
  hashBattleState,
  planMove,
  playTurn,
  previewAttack,
  shotOddsAt,
  threatsAt,
  type BattleContext,
  type BattleState,
  type Command,
  type Scenario,
  type UnitSpawn,
  type Vec2,
} from '@core/index.ts';
import {
  NO_CONDITIONS,
  WEATHERS,
  conditionedRange,
  drawConditions,
  fireFactors,
  groundOf,
  hourOf,
  isNight,
  isSeenBy,
  lightsOf,
  perceivedState,
  shotConditions,
  sightRangeM,
  type Weather,
} from '@core/battle/conditions.ts';
import { fuelOf, previewFireArrow } from '@core/battle/fire.ts';
import { generateBattleMap } from '@core/worldgen/battle.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { IDS, MAP_D, MAP_W, buildFixture, spawn } from './siege-fixture.ts';
import { centerOf, fillRect, flatTerrain } from './helpers.ts';

const RULES = DEFAULT_RULES;
const W = RULES.weather;
const SEED = 'test-conditions';
const DRAW_SEEDS = 400;
/** Tolerance on an observed frequency over DRAW_SEEDS draws (about 4 sigma of a Bernoulli at 0.5). */
const FREQ_TOLERANCE = 0.1;
const NOON = 12;
const MIDNIGHT = 0;
const DIGITS = 9;
/** Nav costs are stored in float32. */
const NAV_DIGITS = 5;
const MAP_SIZE = 80;
const MAP_DEPTH = 12;
const SHOT_ORIGIN: Vec2 = { x: 0, z: 0 };
const SHOT_EAST: Vec2 = { x: 20, z: 0 };
const HEAVY_TIMEOUT_MS = 60_000;

function state(partial: Partial<Pick<BattleState, 'weather' | 'startHour' | 'turn'>> & { wind?: BattleState['wind'] } = {}): BattleState {
  const ctx = createBattleContext(flatTerrain(4, 4), RULES);
  const base = createBattle(ctx, SEED, { units: [] });
  return { ...base, ...partial };
}

function ctxWith(lights: readonly Vec2[] = []): BattleContext {
  return createBattleContext(flatTerrain(MAP_SIZE, MAP_DEPTH), RULES, undefined, [], [], lights);
}

/** A shooter at cell (2, 5) and a militia `dist` metres east of it, on an open field. */
function duel(weather: Weather, startHour: number, dist: number, lights: readonly Vec2[] = [], shooter = 'archer', target = 'militia') {
  const ctx = ctxWith(lights);
  const units: UnitSpawn[] = [
    { id: 'a', typeKey: shooter, position: centerOf(2, 5) },
    { id: 'd', typeKey: target, position: centerOf(2 + dist, 5) },
  ];
  const s = createBattle(ctx, SEED, { units, weather, startHour });
  return { ctx, s };
}

function previewOf(ctx: BattleContext, s: BattleState) {
  const r = previewAttack(ctx, s, 'a', 'd');
  return r.ok ? r.preview : r.reason;
}

describe('drawConditions', () => {
  it('is deterministic for a seed', () => {
    expect(drawConditions(RULES, 'abc')).toEqual(drawConditions(RULES, 'abc'));
  });

  it('draws the hour in startHour, on a quarter hour, and the weather near the odds', () => {
    const count: Record<Weather, number> = { clear: 0, rain: 0, fog: 0 };
    for (let i = 0; i < DRAW_SEEDS; i++) {
      const c = drawConditions(RULES, `weather-${i}`);
      expect(c.startHour).toBeGreaterThanOrEqual(W.startHour[0]);
      expect(c.startHour).toBeLessThanOrEqual(W.startHour[1]);
      expect(c.startHour * 4).toBe(Math.round(c.startHour * 4));
      count[c.weather]++;
    }
    for (const k of WEATHERS) expect(Math.abs(count[k] / DRAW_SEEDS - W.odds[k]), `${k}: ${count[k]}/${DRAW_SEEDS}`).toBeLessThan(FREQ_TOLERANCE);
  });
});

describe('hourOf and isNight', () => {
  const at = (startHour: number, turn: number) => hourOf(RULES, { startHour, turn });

  it('advances hoursPerRound each round and wraps at 24', () => {
    expect(at(8, 1)).toBe(8);
    expect(at(8, 4)).toBeCloseTo(8 + 3 * W.hoursPerRound, DIGITS);
    expect(at(23.5, 4)).toBeCloseTo(23.5 + 3 * W.hoursPerRound - 24, DIGITS);
    expect(at(23.5, 4)).toBeLessThan(1);
    for (let turn = 1; turn < 200; turn++) {
      const h = at(NOON, turn);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    }
  });

  it('is night from nightFrom to nightTo, across midnight', () => {
    expect(isNight(RULES, NOON)).toBe(false);
    expect(isNight(RULES, W.nightFrom)).toBe(true);
    expect(isNight(RULES, W.nightFrom - 0.01)).toBe(false);
    expect(isNight(RULES, MIDNIGHT)).toBe(true);
    expect(isNight(RULES, W.nightTo - 0.01)).toBe(true);
    expect(isNight(RULES, W.nightTo)).toBe(false);
  });
});

describe('shotConditions', () => {
  const ctx = createBattleContext(flatTerrain(40, 40), RULES, undefined, [], [], [{ x: 100, z: 100 }]);
  const kinds = (c: { modifiers: readonly { kind: string }[] }) => c.modifiers.map((m) => m.kind);

  it('is clear at midday: no modifier at all', () => {
    const c = shotConditions(ctx, state({ weather: 'clear', startHour: NOON }), SHOT_ORIGIN, SHOT_EAST, false);
    expect(c.modifiers).toEqual([]);
    expect(c.accuracy).toBe(0);
    expect(c.rangeFactor).toBe(1);
    expect(c.maxRangeM).toBe(Infinity);
    expect(NO_CONDITIONS.modifiers).toEqual([]);
  });

  it('rain: -rainAccuracyPenalty', () => {
    const c = shotConditions(ctx, state({ weather: 'rain', startHour: NOON }), SHOT_ORIGIN, SHOT_EAST, false);
    expect(c.accuracy).toBeCloseTo(-W.rainAccuracyPenalty, DIGITS);
    expect(kinds(c)).toEqual(['rain']);
  });

  it('fog: range capped at fogSightM', () => {
    const c = shotConditions(ctx, state({ weather: 'fog', startHour: NOON }), SHOT_ORIGIN, SHOT_EAST, false);
    expect(c.maxRangeM).toBe(W.fogSightM);
    expect(conditionedRange(100, c)).toBe(W.fogSightM);
    expect(conditionedRange(10, c)).toBe(10);
    expect(kinds(c)).toEqual(['fog']);
  });

  it('night, out of the light: range and accuracy malus; none within lightRadiusM of a torch', () => {
    const night = state({ weather: 'clear', startHour: MIDNIGHT });
    const dark = shotConditions(ctx, night, SHOT_ORIGIN, SHOT_EAST, false);
    expect(dark.rangeFactor).toBe(W.nightRangeFactor);
    expect(dark.accuracy).toBeCloseTo(-W.nightAccuracyPenalty, DIGITS);
    expect(kinds(dark)).toEqual(['night']);

    const torchAt = (dx: number) => createBattleContext(flatTerrain(40, 40), RULES, undefined, [], [], [{ x: SHOT_EAST.x + dx, z: 0 }]);
    expect(shotConditions(torchAt(W.lightRadiusM - 0.5), night, SHOT_ORIGIN, SHOT_EAST, false).modifiers).toEqual([]);
    expect(kinds(shotConditions(torchAt(W.lightRadiusM + 0.5), night, SHOT_ORIGIN, SHOT_EAST, false))).toEqual(['night']);
  });

  it('wind on artillery: nil along the wind, maximal across, absent for direct fire', () => {
    const strength = 0.8;
    const along = state({ wind: { x: 1, z: 0, strength } });
    expect(shotConditions(ctx, along, SHOT_ORIGIN, SHOT_EAST, true).modifiers).toEqual([]);
    expect(shotConditions(ctx, along, SHOT_EAST, SHOT_ORIGIN, true).modifiers).toEqual([]);
    const across = state({ wind: { x: 0, z: 1, strength } });
    const c = shotConditions(ctx, across, SHOT_ORIGIN, SHOT_EAST, true);
    expect(c.accuracy).toBeCloseTo(-W.windArtilleryPenalty * strength, DIGITS);
    expect(kinds(c)).toEqual(['wind']);
    expect(shotConditions(ctx, across, SHOT_ORIGIN, SHOT_EAST, false).modifiers).toEqual([]);
    const diagonal = state({ wind: { x: Math.SQRT1_2, z: Math.SQRT1_2, strength } });
    expect(shotConditions(ctx, diagonal, SHOT_ORIGIN, SHOT_EAST, true).accuracy).toBeCloseTo(-W.windArtilleryPenalty * strength * Math.SQRT1_2, DIGITS);
  });

  it('stacks rain and night', () => {
    const c = shotConditions(ctx, state({ weather: 'rain', startHour: MIDNIGHT }), SHOT_ORIGIN, SHOT_EAST, false);
    expect(c.accuracy).toBeCloseTo(-W.rainAccuracyPenalty - W.nightAccuracyPenalty, DIGITS);
    expect(kinds(c)).toEqual(['rain', 'night']);
  });

  it('small helpers: sightRangeM, groundOf, fireFactors', () => {
    expect(sightRangeM(ctx, state({ weather: 'fog' }))).toBe(W.fogSightM);
    expect(sightRangeM(ctx, state({ weather: 'rain' }))).toBe(Infinity);
    expect(groundOf('rain')).toBe('mud');
    expect(groundOf('fog')).toBe('dry');
    expect(fireFactors(RULES, 'fog')).toEqual({ ignite: 1, fuel: 1, spread: 1 });
    expect(fireFactors(RULES, 'rain')).toEqual(W.rainFire);
  });
});

describe('previewAttack under the conditions', () => {
  const MID_DIST = 10;
  const ARCHER_RANGE = RULES.units['archer']!.attack!.rangeM;
  /** 0.8 x the archer's range: inside it by day, outside the night's 0.7 x. */
  const NIGHT_DIST = Math.round(ARCHER_RANGE * 0.8);

  it('rain lowers the hit chance by exactly rainAccuracyPenalty and lists rain', () => {
    const clear = duel('clear', NOON, MID_DIST);
    const rain = duel('rain', NOON, MID_DIST);
    const a = previewOf(clear.ctx, clear.s);
    const b = previewOf(rain.ctx, rain.s);
    if (typeof a === 'string' || typeof b === 'string') throw new Error('both previews must be ok');
    expect(a.conditions).toEqual([]);
    expect(b.conditions.map((m) => m.kind)).toEqual(['rain']);
    expect(a.blow.hitChance - W.rainAccuracyPenalty).toBeGreaterThan(RULES.damage.hitChanceMin);
    expect(b.blow.hitChance).toBeCloseTo(a.blow.hitChance - W.rainAccuracyPenalty, DIGITS);
  });

  it('at night, a target at 0.8 x range is out of range; by day it is not', () => {
    const day = duel('clear', NOON, NIGHT_DIST);
    expect(previewOf(day.ctx, day.s)).toMatchObject({ targetId: 'd' });
    const night = duel('clear', MIDNIGHT, NIGHT_DIST);
    expect(previewOf(night.ctx, night.s)).toBe('outOfRange');
  });

  it('at night, a target in torchlight stays in range with no modifier', () => {
    const lit = duel('clear', MIDNIGHT, NIGHT_DIST, [centerOf(2 + NIGHT_DIST, 6)]);
    expect(previewOf(lit.ctx, lit.s)).toMatchObject({ targetId: 'd', conditions: [] });
  });

  it('in fog, a target at 31 m is out of range for an archer; at 29 m it is not', () => {
    expect(W.fogSightM).toBe(30);
    expect(ARCHER_RANGE).toBeGreaterThan(W.fogSightM + 1);
    const far = duel('fog', NOON, W.fogSightM + 1);
    expect(previewOf(far.ctx, far.s)).toBe('outOfRange');
    const near = duel('fog', NOON, W.fogSightM - 1);
    expect(previewOf(near.ctx, near.s)).toMatchObject({ conditions: [{ kind: 'fog' }] });
    const clear = duel('clear', NOON, W.fogSightM + 1);
    expect(previewOf(clear.ctx, clear.s)).toMatchObject({ targetId: 'd' });
  });

  it('in melee, no condition applies, whatever the weather and hour', () => {
    const d = duel('rain', MIDNIGHT, 1, [], 'soldier', 'militia');
    expect(previewOf(d.ctx, d.s)).toMatchObject({ melee: true, conditions: [] });
  });

  it('shotOddsAt / threatsAt follow the weather (shotOddsAt only when given the state)', () => {
    const clear = duel('clear', NOON, MID_DIST);
    const rain = duel('rain', NOON, MID_DIST);
    const at = centerOf(2 + MID_DIST, 5);
    const archer = clear.s.units.find((u) => u.id === 'a')!;
    const target = clear.s.units.find((u) => u.id === 'd')!;
    const c = shotOddsAt(clear.ctx, archer, target, at, 1, clear.s)!;
    const r = shotOddsAt(rain.ctx, archer, target, at, 1, rain.s)!;
    expect(r.hitChance).toBeCloseTo(c.hitChance - W.rainAccuracyPenalty, DIGITS);
    expect(shotOddsAt(rain.ctx, archer, target, at, 1)!.hitChance).toBe(c.hitChance);
    const threats = threatsAt(rain.ctx, rain.s, target, at);
    expect(threats).toHaveLength(1);
    expect(threats[0]!.hitChance).toBeCloseTo(c.hitChance - W.rainAccuracyPenalty, DIGITS);
    const fog = duel('fog', NOON, W.fogSightM + 1);
    expect(threatsAt(fog.ctx, fog.s, fog.s.units.find((u) => u.id === 'd')!, centerOf(2 + W.fogSightM + 1, 5))).toEqual([]);
  });
});

describe('fire under the rain', () => {
  const ARCHER = 'att-archer';
  const FIELD_CELL = { x: 44, z: 5 };
  const WOOD_CELL = { x: 20, z: 9 };
  const cell = (x: number, z: number) => z * MAP_W + x;

  function world(weather: Weather) {
    const f = buildFixture(RULES, [spawn(ARCHER, 'archer', 36, 3), spawn('def', 'militia', 60, 2), spawn(IDS.winch, 'towerArcher', 30, 9)]);
    const t = createTerrainData(MAP_W, MAP_D, 1);
    t.layers.set(f.ctx.baseTerrain.layers);
    t.heights.set(f.ctx.baseTerrain.heights);
    fillRect(t, 40, 2, 49, 9, TerrainLayer.Field);
    const ctx = createBattleContext(t, RULES, f.ctx.baseDeck, f.defs);
    return { ctx, s: createBattle(ctx, SEED, { ...f.scenario, weather, startHour: NOON }) };
  }

  it('halves the fuel (1 at least)', () => {
    const dry = world('clear');
    const wet = world('rain');
    const field = cell(FIELD_CELL.x, FIELD_CELL.z);
    expect(fuelOf(dry.ctx, dry.s, field)).toBe(RULES.fire.vegetationTurns);
    expect(fuelOf(wet.ctx, wet.s, field)).toBe(Math.max(1, Math.round(RULES.fire.vegetationTurns * W.rainFire.fuel)));
    expect(fuelOf(wet.ctx, wet.s, cell(WOOD_CELL.x, WOOD_CELL.z))).toBe(Math.max(1, Math.round(RULES.fire.woodTurns * W.rainFire.fuel)));
    expect(fuelOf(wet.ctx, wet.s, cell(2, 2))).toBe(0);
    expect(fuelOf(wet.ctx, { ...wet.s, burnt: [field] }, field)).toBe(0);
  });

  it('multiplies the fire-arrow chance by rainFire.ignite after the accuracy penalty', () => {
    const dry = world('clear');
    const wet = world('rain');
    const at = centerOf(FIELD_CELL.x, FIELD_CELL.z);
    const a = previewFireArrow(dry.ctx, dry.s, ARCHER, at);
    const b = previewFireArrow(wet.ctx, wet.s, ARCHER, at);
    if (!a.ok || !b.ok) throw new Error(`previews must be ok: ${JSON.stringify([a, b])}`);
    expect(b.preview.conditions.map((m) => m.kind)).toEqual(['rain']);
    expect(b.preview.chance).toBeCloseTo((a.preview.chance - W.rainAccuracyPenalty) * W.rainFire.ignite, DIGITS);
  });
});

describe('mud', () => {
  const TRIP_M = 3;
  const lineCost = (ctx: BattleContext, s: BattleState, unit: string): number => {
    const u = s.units.find((x) => x.id === unit)!;
    const r = planMove(ctx, s, unit, { x: u.position.x + TRIP_M, z: u.position.z });
    if (!r.ok) throw new Error(`move rejected: ${r.reason}`);
    return r.plan.apCost;
  };
  const scenarioOf = (weather: Weather): Scenario => ({
    weather,
    startHour: NOON,
    units: [
      { id: 'walker', typeKey: 'archer', position: centerOf(5, 5) },
      { id: 'foot', typeKey: 'soldier', position: centerOf(5, 8) },
      { id: 'far', typeKey: 'militia', position: centerOf(60, 5) },
    ],
  });

  it('raises the cost of a trip on Plain by mudCost; restores it in clear weather; dry key unchanged', () => {
    const ctx = ctxWith();
    const dryKey = ctx.navKey;
    const dry = createBattle(ctx, SEED, scenarioOf('clear'));
    expect(ctx.ground).toBe('dry');
    expect(ctx.navKey).toBe(dryKey);
    expect(ctx.navKey.startsWith('mud#')).toBe(false);
    const dryLight = lineCost(ctx, dry, 'walker');
    const dryFoot = lineCost(ctx, dry, 'foot');

    const wet = createBattle(ctx, SEED, scenarioOf('rain'));
    expect(ctx.ground).toBe('mud');
    expect(lineCost(ctx, wet, 'walker')).toBeCloseTo(dryLight * W.mudCost.lightFoot, NAV_DIGITS);
    expect(lineCost(ctx, wet, 'foot')).toBeCloseTo(dryFoot * W.mudCost.foot, NAV_DIGITS);
    expect(ctx.navKey.startsWith('mud#')).toBe(true);

    const again = createBattle(ctx, SEED, scenarioOf('clear'));
    expect(ctx.ground).toBe('dry');
    expect(lineCost(ctx, again, 'walker')).toBe(dryLight);
    expect(lineCost(ctx, again, 'foot')).toBe(dryFoot);
    expect(ctx.navKey).toBe(dryKey);
  });

  it('leaves the cost alone on a layer that is not muddy (Rampart)', () => {
    expect(W.muddyLayers).not.toContain('Rampart');
    const t = flatTerrain(MAP_SIZE, MAP_DEPTH);
    fillRect(t, 0, 0, MAP_SIZE - 1, MAP_DEPTH - 1, TerrainLayer.Rampart);
    const ctx = createBattleContext(t, RULES);
    const dryCost = lineCost(ctx, createBattle(ctx, SEED, scenarioOf('clear')), 'walker');
    expect(lineCost(ctx, createBattle(ctx, SEED, scenarioOf('rain')), 'walker')).toBe(dryCost);
  });
});

describe('fog of war: perceivedState and isSeenBy', () => {
  const NEAR_M = 20;
  const FAR_M = 50;
  const units: UnitSpawn[] = [
    { id: 'a1', typeKey: 'archer', position: centerOf(2, 5) },
    { id: 'a2', typeKey: 'soldier', position: centerOf(3, 8) },
    { id: 'd-near', typeKey: 'militia', position: centerOf(2 + NEAR_M, 5) },
    { id: 'd-far', typeKey: 'militia', position: centerOf(2 + FAR_M, 5) },
  ];
  const make = (weather: Weather) => {
    const ctx = ctxWith();
    return { ctx, s: createBattle(ctx, SEED, { units, weather, startHour: NOON }) };
  };

  it('without fog the state is returned as is', () => {
    for (const w of ['clear', 'rain'] as const) {
      const { ctx, s } = make(w);
      expect(perceivedState(ctx, s, 'attacker')).toBe(s);
      expect(isSeenBy(ctx, s, 'attacker', centerOf(70, 5))).toBe(true);
    }
  });

  it('in fog, the far enemy disappears, the near one stays, our men never do', () => {
    const { ctx, s } = make('fog');
    const ids = (f: 'attacker' | 'defender') => perceivedState(ctx, s, f).units.map((u) => u.id).sort();
    expect(ids('attacker')).toEqual(['a1', 'a2', 'd-near']);
    expect(isSeenBy(ctx, s, 'attacker', centerOf(2 + NEAR_M, 5))).toBe(true);
    expect(isSeenBy(ctx, s, 'attacker', centerOf(2 + FAR_M, 5))).toBe(false);
    // d-near sees a1 (20 m) and a2 (about 17 m); d-far, alone at 50 m, sees nobody else.
    expect(ids('defender')).toEqual(['a1', 'a2', 'd-far', 'd-near']);
    expect(isSeenBy(ctx, s, 'defender', centerOf(2 + FAR_M + W.fogSightM + 1, 5))).toBe(false);
    expect(s.units).toHaveLength(units.length);
  });

  it('keeps the dead, and an enemy exactly at fogSightM', () => {
    const { ctx, s } = make('fog');
    const edge = { ...s, units: s.units.map((u) => (u.id === 'd-far' ? { ...u, position: centerOf(2 + W.fogSightM, 5) } : u.id === 'd-near' ? { ...u, alive: false } : u)) };
    const seen = perceivedState(ctx, edge, 'attacker').units.map((u) => u.id);
    expect(seen).toContain('d-far');
    expect(seen).toContain('d-near');
  });
});

describe('the AI under fog', () => {
  const AI_SEED = 'test-conditions-ai';
  const BEYOND_SIGHT_M = W.fogSightM + 3;
  const CLOSE_M = 28;
  const MID_M = 25;

  function setup(weather: Weather, enemyDistance: number) {
    const ctx = createBattleContext(flatTerrain(MAP_SIZE, 20), RULES);
    const s = createBattle(ctx, AI_SEED, {
      weather,
      startHour: NOON,
      firstFaction: 'defender',
      units: [
        { id: 'tw', typeKey: 'towerArcher', position: centerOf(5, 10) },
        { id: 'cb', typeKey: 'crossbowman', position: centerOf(6, 12) },
        { id: 'enemy', typeKey: 'soldier', position: centerOf(5 + enemyDistance, 10) },
      ],
    });
    return { ctx, s };
  }

  /** Replays the commands one by one; lists the attacks at an enemy the defenders could not see. */
  function attacksOnUnseen(ctx: BattleContext, s: BattleState, commands: readonly Command[]): string[] {
    const bad: string[] = [];
    let cur = s;
    for (const c of commands) {
      if (c.type === 'attack') {
        const target = cur.units.find((u) => u.id === c.targetId)!;
        if (!isSeenBy(ctx, cur, 'defender', target.position)) bad.push(c.targetId);
      }
      cur = applyCommand(ctx, cur, c).state;
    }
    return bad;
  }

  it('never attacks an enemy it cannot see; does in clear weather', () => {
    const fog = setup('fog', BEYOND_SIGHT_M);
    const fogTurn = playTurn(fog.ctx, fog.s, 'defender');
    expect(fogTurn.commands.some((c) => c.type === 'attack')).toBe(false);
    expect(attacksOnUnseen(fog.ctx, fog.s, fogTurn.commands)).toEqual([]);

    const clear = setup('clear', BEYOND_SIGHT_M);
    const clearTurn = playTurn(clear.ctx, clear.s, 'defender');
    expect(clearTurn.commands.some((c) => c.type === 'attack' && c.targetId === 'enemy')).toBe(true);
  });

  it('attacks a nearby enemy in fog, and only ever visible ones', () => {
    const { ctx, s } = setup('fog', CLOSE_M);
    const turn = playTurn(ctx, s, 'defender');
    expect(turn.commands.some((c) => c.type === 'attack' && c.targetId === 'enemy')).toBe(true);
    expect(attacksOnUnseen(ctx, s, turn.commands)).toEqual([]);
  });

  it('two identical playTurn calls give the same commands and state', () => {
    const a = setup('fog', MID_M);
    const b = setup('fog', MID_M);
    const ta = playTurn(a.ctx, a.s, 'defender');
    const tb = playTurn(b.ctx, b.s, 'defender');
    expect(ta.commands).toEqual(tb.commands);
    expect(hashBattleState(ta.state)).toBe(hashBattleState(tb.state));
    expect(hashBattleState(playTurn(a.ctx, a.s, 'defender').state)).toBe(hashBattleState(ta.state));
  });
});

describe('lightsOf on a generated map', () => {
  let lights: Vec2[];
  let map: ReturnType<typeof generateBattleMap>;
  beforeAll(() => {
    map = generateBattleMap({ seed: 'siege-1', castleIndex: 1 });
    lights = lightsOf(map.layout);
  }, HEAVY_TIMEOUT_MS);

  it('is not empty and holds every gate and house', () => {
    expect(lights.length).toBeGreaterThan(0);
    expect(map.layout.gates.length).toBeGreaterThan(0);
    expect(map.layout.houses.length).toBeGreaterThan(0);
    for (const g of map.layout.gates) expect(lights).toContainEqual(g.center);
    for (const h of map.layout.houses) expect(lights).toContainEqual(h.center);
    expect(lights).toHaveLength(map.layout.gates.length + map.layout.towers.length + map.layout.keeps.length + map.layout.houses.length);
  });
});
