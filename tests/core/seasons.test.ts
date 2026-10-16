/**
 * The campaign's months (ADR-052, src/core/battle/conditions.ts): April's soaked ground is mud
 * without the rain, July's dry crops catch fire better and spread it farther, October's morning
 * mist limits sight and shots until it lifts at 10 h. A skirmish has no month and plays as before.
 * Also the data: the rules' months, the campaign's (one per castle, April to October), their lines.
 */
import { describe, expect, it } from 'vitest';
import {
  RulesValidationError,
  TerrainLayer,
  createBattle,
  createBattleContext,
  createTerrainData,
  planMove,
  validateRules,
  type BattleContext,
  type BattleState,
  type Scenario,
} from '@core/index.ts';
import { fireFactors, groundOf, hourOf, mistSightM, perceivedState, seasonOf, shotConditions, sightRangeM } from '@core/battle/conditions.ts';
import { fireRound, fuelOf, previewFireArrow } from '@core/battle/fire.ts';
import { battleEffects, shapeScenario } from '@core/campaign/scenario.ts';
import { coverLevelAt } from '@core/nav-grid/nav-grid.ts';
import { validateCampaign } from '@core/campaign/validate.ts';
import { CAMPAIGN, DEFAULT_RULES } from '@data/index.ts';
import rawCampaign from '@data/campaign.json' with { type: 'json' };
import { IDS, MAP_D, MAP_W, buildFixture, spawn } from './siege-fixture.ts';
import { centerOf, fillRect, flatTerrain, rawRuleFiles } from './helpers.ts';

const RULES = DEFAULT_RULES;
const W = RULES.weather;
const SEED = 'test-seasons';
const NOON = 12;
const DIGITS = 9;
/** Nav costs are stored in float32. */
const NAV_DIGITS = 5;
const TRIP_M = 3;
const SPREAD_SEEDS = 300;
/** Tolerance on an observed frequency over SPREAD_SEEDS draws (about 4 sigma of a Bernoulli near 0.4). */
const FREQ_TOLERANCE = 0.12;

const april = W.seasons['april']!;
const july = W.seasons['july']!;
const october = W.seasons['october']!;
const mist = october.mist!;

describe('the rules of the months', () => {
  it('ships April (mud), May and June (nothing), July (fire) and October (mist)', () => {
    expect(Object.keys(W.seasons)).toEqual(['april', 'may', 'june', 'july', 'october']);
    expect(april).toMatchObject({ name: 'avril', look: 'spring', mud: true, stubble: false, mist: null, fire: { ignite: 1, fuel: 1, spread: 1 } });
    for (const id of ['may', 'june']) expect(W.seasons[id]).toMatchObject({ look: 'earlySummer', mud: false, mist: null, fire: { ignite: 1, fuel: 1, spread: 1 } });
    expect(july.fire.ignite).toBeGreaterThan(1);
    expect(july.fire.spread).toBeGreaterThan(1);
    expect(july.mud).toBe(false);
    expect(mist.sightM).toBeGreaterThan(W.fogSightM);
    expect(Object.keys(W.seasons)).not.toContain('$comment');
  });

  it('rejects a broken month, naming its path', () => {
    const bad = (mutate: (s: Record<string, Record<string, unknown>>) => void, path: RegExp) => {
      const raw = rawRuleFiles();
      mutate((raw.damage as { weather: { seasons: Record<string, Record<string, unknown>> } }).weather.seasons);
      expect(() => validateRules(raw)).toThrow(RulesValidationError);
      expect(() => validateRules(raw)).toThrow(path);
    };
    bad((s) => (s['april']!['look'] = 'winter'), /damage\.weather\.seasons\.april\.look/);
    bad((s) => (s['july']!['fire'] = { ignite: 9, fuel: 1, spread: 1 }), /damage\.weather\.seasons\.july\.fire\.ignite/);
    bad((s) => (s['october']!['mist'] = { sightM: 0, untilHour: 10 }), /damage\.weather\.seasons\.october\.mist\.sightM/);
    bad((s) => (s['may']!['mud'] = 'yes'), /damage\.weather\.seasons\.may\.mud/);
  });
});

/** A small open field with an archer, a soldier and, far east, a militia. */
function scenarioOf(partial: Partial<Scenario> = {}): Scenario {
  return {
    weather: 'clear',
    startHour: NOON,
    units: [
      { id: 'walker', typeKey: 'archer', position: centerOf(5, 5) },
      { id: 'foot', typeKey: 'soldier', position: centerOf(5, 8) },
      { id: 'far', typeKey: 'militia', position: centerOf(70, 5) },
    ],
    ...partial,
  };
}

describe('a battle in its month', () => {
  it('keeps the month in its state; a skirmish has none, and an unknown month is refused', () => {
    const ctx = createBattleContext(flatTerrain(80, 12), RULES);
    expect(createBattle(ctx, SEED, scenarioOf({ season: 'june' })).season).toBe('june');
    const skirmish = createBattle(ctx, SEED, scenarioOf());
    expect('season' in skirmish).toBe(false);
    expect(seasonOf(RULES, skirmish)).toBeNull();
    expect(() => createBattle(ctx, SEED, scenarioOf({ season: 'toString' }))).toThrow(/unknown season/);
  });
});

describe('April: the soaked ground', () => {
  const lineCost = (ctx: BattleContext, s: BattleState, unit: string): number => {
    const u = s.units.find((x) => x.id === unit)!;
    const r = planMove(ctx, s, unit, { x: u.position.x + TRIP_M, z: u.position.z });
    if (!r.ok) throw new Error(`move rejected: ${r.reason}`);
    return r.plan.apCost;
  };

  it('is mud under a clear sky, as costly as the rain’s, without the rain’s penalty to shots', () => {
    const ctx = createBattleContext(flatTerrain(80, 12), RULES);
    const dry = createBattle(ctx, SEED, scenarioOf());
    const dryFoot = lineCost(ctx, dry, 'foot');
    const soaked = createBattle(ctx, SEED, scenarioOf({ season: 'april' }));
    expect(ctx.ground).toBe('mud');
    expect(groundOf(RULES, soaked)).toBe('mud');
    expect(lineCost(ctx, soaked, 'foot')).toBeCloseTo(dryFoot * W.mudCost.foot, NAV_DIGITS);
    expect(shotConditions(ctx, soaked, { x: 0, z: 0 }, { x: 20, z: 0 }, false).modifiers).toEqual([]);
    expect(groundOf(RULES, { weather: 'clear', season: 'may' })).toBe('dry');
    expect(groundOf(RULES, { weather: 'rain', season: 'may' })).toBe('mud');
  });
});

describe('July: the dry crops', () => {
  const ARCHER = 'att-archer';
  const FIELD = { x0: 40, z0: 2, x1: 49, z1: 9 };
  const MID = { x: 44, z: 5 };
  const cell = (x: number, z: number) => z * MAP_W + x;

  function world() {
    const f = buildFixture(RULES, [spawn(ARCHER, 'archer', 36, 3), spawn('def', 'militia', 60, 2), spawn(IDS.winch, 'towerArcher', 30, 9)]);
    const t = createTerrainData(MAP_W, MAP_D, 1);
    t.layers.set(f.ctx.baseTerrain.layers);
    t.heights.set(f.ctx.baseTerrain.heights);
    fillRect(t, FIELD.x0, FIELD.z0, FIELD.x1, FIELD.z1, TerrainLayer.Field);
    const ctx = createBattleContext(t, RULES, f.ctx.baseDeck, f.defs);
    return { ctx, scenario: { ...f.scenario, weather: 'clear' as const, startHour: NOON } };
  }

  it('multiplies the fire factors by the month’s, and by the rain’s too under the rain', () => {
    expect(fireFactors(RULES, { weather: 'clear', season: 'july' })).toEqual(july.fire);
    expect(fireFactors(RULES, { weather: 'clear', season: 'june' })).toEqual({ ignite: 1, fuel: 1, spread: 1 });
    expect(fireFactors(RULES, { weather: 'clear' })).toEqual({ ignite: 1, fuel: 1, spread: 1 });
    expect(fireFactors(RULES, { weather: 'rain' })).toEqual(W.rainFire);
    const wet = fireFactors(RULES, { weather: 'rain', season: 'july' });
    expect(wet.ignite).toBeCloseTo(W.rainFire.ignite * july.fire.ignite, DIGITS);
    expect(wet.spread).toBeCloseTo(W.rainFire.spread * july.fire.spread, DIGITS);
  });

  it('a fire arrow catches better, never to a certainty; the fuel stays', () => {
    const { ctx, scenario } = world();
    const june = createBattle(ctx, SEED, { ...scenario, season: 'june' });
    const dry = createBattle(ctx, SEED, { ...scenario, season: 'july' });
    const at = centerOf(MID.x, MID.z);
    const a = previewFireArrow(ctx, june, ARCHER, at);
    const b = previewFireArrow(ctx, dry, ARCHER, at);
    if (!a.ok || !b.ok) throw new Error(`previews must be ok: ${JSON.stringify([a, b])}`);
    expect(b.preview.chance).toBeCloseTo(Math.min(RULES.damage.hitChanceMax, a.preview.chance * july.fire.ignite), DIGITS);
    expect(b.preview.chance).toBeLessThanOrEqual(RULES.damage.hitChanceMax);
    expect(fuelOf(ctx, dry, cell(MID.x, MID.z))).toBe(fuelOf(ctx, june, cell(MID.x, MID.z)));
  });

  it('spreads more often (same seeds, no wind): near spreadChance × the month’s factor', () => {
    const { ctx, scenario } = world();
    const target = cell(MID.x + 1, MID.z);
    const lit = (season: string) => {
      let count = 0;
      for (let i = 0; i < SPREAD_SEEDS; i++) {
        const s = createBattle(ctx, `spread-${i}`, { ...scenario, season });
        const calm: BattleState = { ...s, fires: [{ cell: cell(MID.x, MID.z), turnsLeft: RULES.fire.vegetationTurns }], wind: { x: 1, z: 0, strength: 0 } };
        if (fireRound(ctx, calm, []).fires.some((f) => f.cell === target)) count++;
      }
      return count / SPREAD_SEEDS;
    };
    const june = lit('june');
    const dry = lit('july');
    expect(dry).toBeGreaterThan(june);
    expect(Math.abs(dry - Math.min(RULES.fire.spreadMax, RULES.fire.spreadChance * july.fire.spread))).toBeLessThan(FREQ_TOLERANCE);
  });
});

describe('October: the morning mist', () => {
  const ctx = createBattleContext(flatTerrain(80, 12), RULES);
  const at = (turn: number, extra: Partial<Scenario> = {}) => ({ ...createBattle(ctx, SEED, scenarioOf({ season: 'october', startHour: 8, ...extra })), turn });
  /** The first round whose clock reaches untilHour (rounds last a third of an hour, a little short). */
  const liftRound = 1 + Math.ceil((mist.untilHour - 8) / W.hoursPerRound - 0.05);

  it('limits sight and shots to its reach, then lifts in the first round past its hour', () => {
    const morning = at(1);
    expect(mistSightM(RULES, morning)).toBe(mist.sightM);
    expect(sightRangeM(ctx, morning)).toBe(mist.sightM);
    const c = shotConditions(ctx, morning, { x: 0, z: 0 }, { x: 20, z: 0 }, false);
    expect(c.maxRangeM).toBe(mist.sightM);
    expect(c.modifiers).toEqual([{ kind: 'mist', accuracy: 0, rangeFactor: 1, limitM: mist.sightM }]);

    const last = at(liftRound - 1);
    expect(mistSightM(RULES, last)).toBe(mist.sightM);
    expect(hourOf(RULES, last)).toBeLessThan(mist.untilHour);
    const lifted = at(liftRound);
    expect(hourOf(RULES, lifted)).toBeGreaterThan(mist.untilHour - W.hoursPerRound / 2);
    expect(mistSightM(RULES, lifted)).toBeNull();
    expect(sightRangeM(ctx, lifted)).toBe(Infinity);
    expect(shotConditions(ctx, lifted, { x: 0, z: 0 }, { x: 20, z: 0 }, false).modifiers).toEqual([]);
  });

  it('hides the far enemy from each side while it lasts', () => {
    const morning = at(1);
    expect(perceivedState(ctx, morning, 'attacker').units.map((u) => u.id)).not.toContain('far');
    const lifted = at(liftRound);
    expect(perceivedState(ctx, lifted, 'attacker')).toBe(lifted);
  });

  it('lifts in the round whose clock shows its hour, a hair short of it (the rounds’ sum)', () => {
    // At 8 h + 6 rounds the clock reads 10 h, the sum of the rounds 9.9998 h: a mist "until 10 h" is gone.
    const tenOClock = { season: 'october', startHour: 8, turn: 7 } as const;
    expect(hourOf(RULES, tenOClock)).toBeLessThan(10);
    const until10 = { ...RULES, weather: { ...W, seasons: { ...W.seasons, october: { ...october, mist: { sightM: mist.sightM, untilHour: 10 } } } } };
    expect(mistSightM(until10, tenOClock)).toBeNull();
    expect(mistSightM(until10, { ...tenOClock, turn: 6 })).toBe(mist.sightM);
  });

  it('gives way to a thicker fog: the fog’s reach binds, no mist listed', () => {
    const foggy = at(1, { weather: 'fog' });
    expect(sightRangeM(ctx, foggy)).toBe(W.fogSightM);
    expect(shotConditions(ctx, foggy, { x: 0, z: 0 }, { x: 20, z: 0 }, false).modifiers.map((m) => m.kind)).toEqual(['fog']);
  });

  it('finds the fields harvested: their stubble gives no cover and blocks no sight; an autumn rain adds the mud', () => {
    const t = flatTerrain(80, 12);
    fillRect(t, 10, 2, 20, 9, TerrainLayer.Field);
    const fields = createBattleContext(t, RULES);
    const cell = 5 * 80 + 15;
    createBattle(fields, SEED, scenarioOf({ season: 'june' }));
    expect(coverLevelAt(fields.nav, cell)).toBe('light');
    expect(fields.nav.sightHeight[cell]).toBeGreaterThan(0);
    createBattle(fields, SEED, scenarioOf({ season: 'october' }));
    expect(fields.ground).toBe('stubble');
    expect(coverLevelAt(fields.nav, cell)).toBe('none');
    expect(fields.nav.sightHeight[cell]).toBe(0);
    expect(groundOf(RULES, { weather: 'rain', season: 'october' })).toBe('mudStubble');
    createBattle(fields, SEED, scenarioOf({ season: 'october', weather: 'rain' }));
    expect(coverLevelAt(fields.nav, cell)).toBe('none');
    expect(fields.navKey.startsWith('mudStubble#')).toBe(true);
  });

  it('is none in another month, or without one', () => {
    expect(mistSightM(RULES, { ...at(1), season: 'july' })).toBeNull();
    expect(mistSightM(RULES, { startHour: 8, turn: 1 })).toBeNull();
  });
});

describe('the campaign’s months', () => {
  it('runs from April to October, one month a castle, in the campaign’s order, each with its line', () => {
    expect(CAMPAIGN.levels.map((l) => l.battle.season)).toEqual(['april', 'may', 'june', 'july', 'october']);
    for (const level of CAMPAIGN.levels) expect(CAMPAIGN.seasons[level.battle.season!]).toMatch(/^[A-Z]\w+\. /);
    expect(CAMPAIGN.tutorial.battle.season).toBeUndefined();
  });

  it('carries the castle’s month into its scenario', () => {
    const ctx = createBattleContext(flatTerrain(80, 12), RULES);
    for (const level of CAMPAIGN.levels) expect(shapeScenario(ctx, scenarioOf(), battleEffects(level, null)).season).toBe(level.battle.season);
  });

  it('rejects an unknown month, a line for a month the rules lack, a castle without its line', () => {
    const raw = () => structuredClone(rawCampaign) as unknown as Record<string, unknown> & { levels: { battle: Record<string, unknown> }[]; seasons: Record<string, unknown> };
    const bad = (mutate: (c: ReturnType<typeof raw>) => void, path: RegExp) => {
      const c = raw();
      mutate(c);
      expect(() => validateCampaign(c, RULES)).toThrow(RulesValidationError);
      expect(() => validateCampaign(c, RULES)).toThrow(path);
    };
    bad((c) => (c.levels[0]!.battle['season'] = 'winter'), /levels\[0\]\.battle\.season/);
    bad((c) => (c.seasons['winter'] = 'Hiver.'), /seasons\.winter: unknown season/);
    bad((c) => delete c.seasons['april'], /levels\[0\]\.battle\.season: no line/);
  });
});
