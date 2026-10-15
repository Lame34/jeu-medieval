/**
 * The campaign (J6): the data's validation, the garrison groups of a generated map, the battle's
 * starting conditions (damaged structures, causeways, morale by side) and the shaping of a
 * castle's scenario by its effects and the chosen stratagem, on the real map of Roche-Grise. The
 * map takes seconds to generate: it is built once, in beforeAll.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createBattle, createBattleContext, hashBattleState, isPassable, previewAttack, replay, ScenarioError, type BattleContext, type BattleState, type Command, type Scenario, type UnitSpawn, type Vec2 } from '@core/index.ts';
import { facingSlot } from '@core/battle/approaches.ts';
import { DEFAULT_MORALE } from '@core/battle/create.ts';
import { heroSpawnCells } from '@core/battle/heroes.ts';
import { fillCells, fillSites, moatsOf } from '@core/battle/moat.ts';
import { planStructures } from '@core/battle/structures.ts';
import { bannerCount, bannersOf, battleEffects, campaignBattle, featDone, shapeScenario, woundedHeroes } from '@core/campaign/scenario.ts';
import { validateCampaign } from '@core/campaign/validate.ts';
import { RulesValidationError } from '@core/rules/json.ts';
import { TerrainLayer } from '@core/rules/types.ts';
import { generateBattleMap } from '@core/worldgen/battle.ts';
import { garrisonGroupOf } from '@core/worldgen/garrison.ts';
import type { WorldLayout } from '@core/worldgen/types.ts';
import { CAMPAIGN, DEFAULT_RULES } from '@data/index.ts';
import rawCampaign from '@data/campaign.json' with { type: 'json' };

const SEED = 'orle-roche';
const CASTLE_INDEX = 1;
/** Map generation is a few seconds; the hook's budget is raised accordingly. */
const HEAVY_TIMEOUT_MS = 60_000;
const WINCH_ID = 'def-tower-0';
const HEROES = Object.keys(DEFAULT_RULES.heroes);

let layout: WorldLayout;
let ctx: BattleContext;
let base: Scenario;

const raw = () => structuredClone(rawCampaign) as unknown as Record<string, unknown> & { levels: Record<string, unknown>[] };
const ids = (s: Scenario) => s.units.map((u) => u.id);
const factionOf = (u: UnitSpawn) => DEFAULT_RULES.units[u.typeKey]?.faction;
const centroid = (pts: readonly Vec2[]): Vec2 => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, z: pts.reduce((a, p) => a + p.z, 0) / pts.length });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

beforeAll(() => {
  layout = generateBattleMap({ seed: SEED, castleIndex: CASTLE_INDEX }).layout;
  ctx = createBattleContext(layout.terrain, DEFAULT_RULES, layout.deck, planStructures(layout, DEFAULT_RULES.structures), moatsOf(layout));
  const units: UnitSpawn[] = layout.units.flatMap((m) => {
    const type = DEFAULT_RULES.units[m.typeKey];
    if (!type || !isPassable(ctx.nav, type.movement, Math.floor(m.position.x), Math.floor(m.position.z))) return [];
    return [{ id: m.id, typeKey: m.typeKey, position: m.position }];
  });
  // The heroes join behind the army, as the battle session places them.
  const army = centroid(units.filter((u) => factionOf(u) === 'attacker').map((u) => u.position));
  const free = (p: Vec2) => isPassable(ctx.nav, 'foot', Math.floor(p.x), Math.floor(p.z)) && units.every((u) => dist(u.position, p) >= 1.5);
  heroSpawnCells(army, free, HEROES.length).forEach((position, i) => units.push({ id: `att-hero-${HEROES[i]}`, typeKey: HEROES[i] as string, position }));
  base = { units, firstFaction: 'attacker' };
}, HEAVY_TIMEOUT_MS);

describe('validateCampaign', () => {
  it('ships a tutorial and five castles of rising difficulty, each with one plan per hero', () => {
    expect(CAMPAIGN.tutorial.id).toBe('fortin');
    expect(CAMPAIGN.levels).toHaveLength(5);
    expect(CAMPAIGN.levels.map((l) => l.difficulty)).toEqual([1, 2, 3, 4, 5]);
    for (const level of CAMPAIGN.levels) expect(level.stratagems.map((s) => s.hero).sort()).toEqual([...HEROES].sort());
    for (const hero of HEROES) expect(CAMPAIGN.heroLines[hero]?.victory.length).toBeGreaterThan(0);
  });

  it('names the JSON path of a broken entry', () => {
    const bad = (mutate: (c: ReturnType<typeof raw>) => void, path: RegExp) => {
      const c = raw();
      mutate(c);
      expect(() => validateCampaign(c, DEFAULT_RULES)).toThrow(RulesValidationError);
      expect(() => validateCampaign(c, DEFAULT_RULES)).toThrow(path);
    };
    const plan = (c: ReturnType<typeof raw>, level: number, i: number) => ((c.levels[level]!['stratagems'] as Record<string, unknown>[])[i] as Record<string, Record<string, unknown>>);
    bad((c) => (plan(c, 0, 0)['effects']!['reinforce'] = [{ typeKey: 'dragon', count: 1 }]), /levels\[0\]\.stratagems\[0\]\.effects\.reinforce\[0\]\.typeKey: unknown unit type/);
    bad((c) => (plan(c, 0, 0)['effects']!['reinforce'] = [{ typeKey: 'militia', count: 1 }]), /is not a attacker unit/);
    bad((c) => (plan(c, 0, 0)['effects']!['cut'] = [{ typeKey: 'knight', count: 1 }]), /is not a defender unit/);
    bad((c) => (plan(c, 1, 0)['effects']!['structures'] = [{ kind: 'gate' }]), /expected hpFraction or broken: true/);
    bad((c) => (plan(c, 1, 0)['effects']!['morale'] = { defender: -90 }), /morale\.defender/);
    bad((c) => (c.levels[2]!['stratagems'] as unknown[]).pop(), /one stratagem per hero/);
    bad((c) => (c.levels[3]!['castleIndex'] = 5), /levels\[3\]\.castleIndex/);
    bad((c) => (c.levels[4]!['id'] = 'roche-grise'), /duplicate battle id/);
  });
});

describe('garrisonGroupOf', () => {
  it('reads the group from a generated defender id', () => {
    expect(garrisonGroupOf('def-out-2')).toBe('outpost');
    expect(garrisonGroupOf('def-wall-1')).toBe('wall');
    expect(garrisonGroupOf('def-tower-0')).toBe('tower');
    expect(garrisonGroupOf('def-1')).toBe('courtyard');
    expect(garrisonGroupOf('att-0')).toBeNull();
    expect(garrisonGroupOf('def-camp')).toBeNull();
  });

  it('covers every defender of the map', () => {
    for (const u of base.units) if (factionOf(u) === 'defender') expect(garrisonGroupOf(u.id)).not.toBeNull();
  });
});

describe('createBattle: a scenario’s starting conditions', () => {
  const kind = (k: string) => ctx.structures.find((d) => d.kind === k)!;

  it('starts each side at its own morale', () => {
    const state = createBattle(ctx, SEED, { ...base, morale: { defender: 40 } });
    for (const u of state.units) expect(u.morale).toBe(u.faction === 'defender' ? 40 : DEFAULT_MORALE);
  });

  it('lowers the drawbridge and weakens the gate before the first round', () => {
    const bridge = kind('drawbridge');
    const gate = kind('gate');
    const state = createBattle(ctx, SEED, { ...base, structures: [{ id: bridge.id, broken: true }, { id: gate.id, hpFraction: 0.5 }] });
    expect(state.structures.find((s) => s.id === bridge.id)).toMatchObject({ broken: true, hp: 0 });
    expect(state.structures.find((s) => s.id === gate.id)).toMatchObject({ broken: false, hp: Math.round(gate.maxHp * 0.5) });
    // The nav grid follows: the lowered bridge is a deck across the moat.
    for (const i of bridge.cells) expect(ctx.nav.terrain.layers[i]).toBe(TerrainLayer.Bridge);
  });

  it('lays the causeways of the scenario, done, and the nav grid crosses them', () => {
    const site = [...fillSites(ctx).keys()][0]!;
    const state = createBattle(ctx, SEED, { ...base, filled: [site, site] });
    expect(state.works).toEqual([{ id: site, progress: DEFAULT_RULES.structures.fillTurns, done: true }]);
    for (const i of fillCells(ctx, site)) expect(ctx.nav.terrain.layers[i]).toBe(TerrainLayer.Fascine);
  });

  it('rejects an unknown structure, a fraction out of (0, 1], an unknown fill site', () => {
    expect(() => createBattle(ctx, SEED, { ...base, structures: [{ id: 'wall:nowhere:0', broken: true }] })).toThrow(ScenarioError);
    expect(() => createBattle(ctx, SEED, { ...base, structures: [{ id: kind('gate').id, hpFraction: 0 }] })).toThrow(/outside \(0, 1\]/);
    expect(() => createBattle(ctx, SEED, { ...base, structures: [{ id: kind('gate').id, hpFraction: 1.5 }] })).toThrow(ScenarioError);
    expect(() => createBattle(ctx, SEED, { ...base, filled: ['fill:nowhere:3'] })).toThrow(/unknown fill site/);
  });
});

describe('shapeScenario', () => {
  it('leaves out the last defenders of a group and type first', () => {
    const shaped = shapeScenario(ctx, base, [{ cut: [{ group: 'wall', typeKey: 'crossbowman', count: 1 }] }]);
    const crossbows = base.units.filter((u) => garrisonGroupOf(u.id) === 'wall' && u.typeKey === 'crossbowman').map((u) => u.id).sort();
    expect(crossbows.length).toBeGreaterThanOrEqual(2);
    expect(ids(shaped)).not.toContain(crossbows[crossbows.length - 1]);
    expect(ids(shaped)).toContain(crossbows[0]);
    expect(shaped.units).toHaveLength(base.units.length - 1);
  });

  it('never leaves out the drawbridge’s winch operator', () => {
    const towers = base.units.filter((u) => garrisonGroupOf(u.id) === 'tower');
    const shaped = shapeScenario(ctx, base, [{ cut: [{ group: 'tower', count: towers.length + 2 }] }]);
    expect(ids(shaped)).toContain(WINCH_ID);
    expect(shaped.units.filter((u) => garrisonGroupOf(u.id) === 'tower')).toHaveLength(1);
  });

  it('brings reinforcements behind the army, on free cells they can stand on', () => {
    const shaped = shapeScenario(ctx, base, [{ reinforce: [{ typeKey: 'cavalry', count: 2 }, { typeKey: 'catapult', count: 1 }] }]);
    const added = shaped.units.filter((u) => !ids(base).includes(u.id));
    expect(added.map((u) => u.id).sort()).toEqual(['att-camp-catapult-0', 'att-camp-cavalry-0', 'att-camp-cavalry-1']);
    // Men gather behind the army, engines behind the siege park.
    const castle = centroid(ctx.structures.map((d) => d.center));
    const isEngine = (u: UnitSpawn) => DEFAULT_RULES.units[u.typeKey]!.tags.includes('siegeEngine');
    const attackers = base.units.filter((u) => factionOf(u) === 'attacker');
    const army = centroid(attackers.filter((u) => !isEngine(u)).map((u) => u.position));
    const park = centroid(attackers.filter(isEngine).map((u) => u.position));
    for (const u of added) {
      const type = DEFAULT_RULES.units[u.typeKey]!;
      expect(isPassable(ctx.nav, type.movement, Math.floor(u.position.x), Math.floor(u.position.z))).toBe(true);
      for (const other of shaped.units) if (other.id !== u.id) expect(dist(other.position, u.position)).toBeGreaterThanOrEqual(1.5);
      const from = isEngine(u) ? park : army;
      expect(dist(u.position, castle)).toBeGreaterThan(dist(from, castle));
    }
    expect(() => createBattle(ctx, SEED, shaped)).not.toThrow();
  });

  it('weakens the structure of each kind nearest the army', () => {
    const shaped = shapeScenario(ctx, base, [{ structures: [{ kind: 'wall', hpFraction: 0.3 }, { kind: 'gate', hpFraction: 0.5 }] }]);
    const front = centroid(base.units.filter((u) => factionOf(u) === 'attacker').map((u) => u.position));
    const nearestWall = ctx.structures.filter((d) => d.kind === 'wall').sort((a, b) => dist(a.center, front) - dist(b.center, front))[0]!;
    expect(shaped.structures).toEqual([
      { id: nearestWall.id, hpFraction: 0.3 },
      { id: ctx.structures.find((d) => d.kind === 'gate')!.id, hpFraction: 0.5 },
    ]);
  });

  it('lays the causeway in front of the wall nearest the siege tower', () => {
    const shaped = shapeScenario(ctx, base, [{ fillMoat: 1 }]);
    const tower = base.units.find((u) => u.typeKey === 'siegeTower')!.position;
    const walls = ctx.structures.filter((d) => d.kind === 'wall').sort((a, b) => dist(a.center, tower) - dist(b.center, tower));
    const expected = walls.map((w) => facingSlot(ctx, w, ctx.moats[0]!.centerline)).find((s) => s !== null);
    expect(shaped.filled).toEqual([expected]);
    expect(createBattle(ctx, SEED, shaped).works.map((w) => w.id)).toEqual([expected]);
  });

  it('sets the conditions by the last effect, adds the delays, and bounds them', () => {
    const shaped = shapeScenario(ctx, base, [{ weather: 'fog', startHour: 7, turnLimit: 20 }, { weather: 'clear', turnDelta: -3 }]);
    expect(shaped).toMatchObject({ weather: 'clear', startHour: 7, turnLimit: 17 });
    expect(shapeScenario(ctx, base, [{ turnDelta: -6 }, { turnDelta: -6 }, { turnDelta: -6 }]).turnLimit).toBe(8);
    // A deadline set outright stands, however short (the tests' ?turns=1).
    expect(shapeScenario(ctx, base, [{ turnLimit: 1 }]).turnLimit).toBe(1);
    expect(shapeScenario(ctx, base, []).turnLimit).toBe(DEFAULT_RULES.battle.turnLimit);
  });

  it('adds morale by side, never starting a side shaken nor above the maximum', () => {
    const { shakenBelow, max } = DEFAULT_RULES.morale;
    expect(shapeScenario(ctx, base, [{ morale: { defender: -10 } }, { morale: { defender: -5, attacker: 15 } }]).morale).toEqual({ defender: DEFAULT_MORALE - 15, attacker: DEFAULT_MORALE + 15 });
    expect(shapeScenario(ctx, base, [{ morale: { defender: -40 } }, { morale: { defender: -40, attacker: 40 } }]).morale).toEqual({ defender: shakenBelow, attacker: max });
    expect(shapeScenario(ctx, base, []).morale).toBeUndefined();
  });

  it('keeps resting heroes out of the battle', () => {
    const shaped = shapeScenario(ctx, base, [], ['heroArcher']);
    expect(shaped.units.some((u) => u.typeKey === 'heroArcher')).toBe(false);
    expect(shaped.units.some((u) => u.typeKey === 'heroKnight')).toBe(true);
  });

  it('is deterministic, and its battle replays to the same state', () => {
    const level = CAMPAIGN.levels[0]!;
    const plan = level.stratagems[1]!;
    const a = shapeScenario(ctx, base, battleEffects(level, plan));
    expect(shapeScenario(ctx, base, battleEffects(level, plan))).toEqual(a);
    const start = createBattle(ctx, SEED, a);
    const commands: Command[] = [{ type: 'endTurn' }, { type: 'endTurn' }];
    let state: BattleState = start;
    for (const c of commands) state = applyCommand(ctx, state, c).state;
    expect(hashBattleState(replay(ctx, SEED, a, commands).state)).toBe(hashBattleState(state));
  });
});

describe('the player’s rank (ADR-045)', () => {
  const level = () => CAMPAIGN.levels[0]!;
  const defenders = (sc: Scenario) => sc.units.filter((u) => factionOf(u) === 'defender').length;

  it('ships three ranks, the knight changing nothing', () => {
    expect(Object.keys(CAMPAIGN.ranks)).toEqual(['squire', 'knight', 'baron']);
    const knight = shapeScenario(ctx, base, battleEffects(level(), null, CAMPAIGN.ranks.knight));
    expect(knight).toEqual(shapeScenario(ctx, base, battleEffects(level(), null)));
  });

  it('a squire faces a thinner, clumsier garrison, with more time; a baron, the full garrison, abler, with less', () => {
    const plain = shapeScenario(ctx, base, battleEffects(level(), null));
    const squire = shapeScenario(ctx, base, battleEffects(level(), null, CAMPAIGN.ranks.squire));
    const baron = shapeScenario(ctx, base, battleEffects(level(), null, CAMPAIGN.ranks.baron));
    const castleCut = (level().battle.cut ?? []).reduce((n, c) => n + c.count, 0);
    expect(defenders(squire)).toBe(defenders(plain) - 2);
    expect(defenders(baron)).toBe(defenders(plain) + castleCut);
    expect(squire.turnLimit).toBe(plain.turnLimit! + (CAMPAIGN.ranks.squire.effects.turnDelta ?? 0));
    expect(baron.turnLimit).toBe(plain.turnLimit! + (CAMPAIGN.ranks.baron.effects.turnDelta ?? 0));
    expect(squire.aim).toEqual({ defender: CAMPAIGN.ranks.squire.effects.aim?.defender });
    expect(baron.aim).toEqual({ defender: CAMPAIGN.ranks.baron.effects.aim?.defender });
    expect(plain.aim).toBeUndefined();
  });

  it('the garrison’s skill at arms moves the hit chance of its blows and shots, not of ours', () => {
    const clumsy = -0.1;
    const shaped: Scenario = {
      units: [
        { id: 'att', typeKey: 'soldier', position: { x: 300.5, z: 300.5 } },
        { id: 'def', typeKey: 'wallGuard', position: { x: 301.5, z: 300.5 } },
      ],
      firstFaction: 'defender',
    };
    const odds = (sc: Scenario, who: string, whom: string) => {
      const b = createBattle(ctx, SEED, sc);
      const r = previewAttack(ctx, b, who, whom);
      if (!r.ok) throw new Error(r.reason);
      return r.preview;
    };
    const plain = odds(shaped, 'def', 'att');
    const weak = odds({ ...shaped, aim: { defender: clumsy } }, 'def', 'att');
    expect(weak.blow.hitChance - plain.blow.hitChance).toBeCloseTo(clumsy, 9);
    expect(weak.conditions).toContainEqual({ kind: 'aim', accuracy: clumsy, rangeFactor: 1 });
    const ours = (sc: Scenario) => odds({ ...sc, firstFaction: 'attacker' }, 'att', 'def').blow.hitChance;
    expect(ours({ ...shaped, aim: { defender: clumsy } })).toBe(ours(shaped));
  });

  it('rejects a skill at arms beyond ±0.3 and a missing rank', () => {
    const tooAble = raw();
    (tooAble['ranks'] as Record<string, { effects: Record<string, unknown> }>)['baron']!.effects['aim'] = { defender: 0.5 };
    expect(() => validateCampaign(tooAble, DEFAULT_RULES)).toThrow(RulesValidationError);
    const noBaron = raw();
    delete (noBaron['ranks'] as Record<string, unknown>)['baron'];
    expect(() => validateCampaign(noBaron, DEFAULT_RULES)).toThrow(/ranks\.baron/);
  });
});

describe('banners and wounds', () => {
  let state: BattleState;
  beforeAll(() => {
    state = createBattle(ctx, SEED, base);
  });
  const kill = (s: BattleState, n: number, faction: 'attacker' | 'defender' = 'attacker'): BattleState => {
    const dead = s.units.filter((u) => u.faction === faction).slice(0, n).map((u) => u.id);
    return { ...s, units: s.units.map((u) => (dead.includes(u.id) ? { ...u, alive: false, hp: 0 } : u)) };
  };

  it('a swift victory with few losses wins three; the feat of arms, the fourth', () => {
    const won: BattleState = { ...state, status: 'attackerWon', turn: 10, turnLimit: 24 };
    expect(bannersOf(CAMPAIGN, DEFAULT_RULES, won)).toEqual({ taken: true, swift: true, spared: true, feat: false });
    expect(bannerCount(bannersOf(CAMPAIGN, DEFAULT_RULES, won))).toBe(3);
    const feat = CAMPAIGN.levels[0]!.feat;
    expect(feat.kind).toBe('summons');
    expect(bannersOf(CAMPAIGN, DEFAULT_RULES, { ...won, summons: { lastTurn: 9, accepted: true } }, feat).feat).toBe(true);
    expect(bannerCount(bannersOf(CAMPAIGN, DEFAULT_RULES, { ...won, summons: { lastTurn: 9, accepted: true } }, feat))).toBe(4);
  });

  it('each kind of feat is judged on the battle’s end, and only for a castle taken', () => {
    const won: BattleState = { ...state, status: 'attackerWon', turn: 10, turnLimit: 24 };
    const kind = (k: string) => CAMPAIGN.levels.find((l) => l.feat.kind === k)!.feat;
    expect(featDone(DEFAULT_RULES, kind('mine'), { ...won, works: [{ id: 'mine:wall:x', progress: 3, done: true }] })).toBe(true);
    expect(featDone(DEFAULT_RULES, kind('mine'), { ...won, works: [{ id: 'fill:moat:1', progress: 2, done: true }] })).toBe(false);
    expect(featDone(DEFAULT_RULES, kind('tower'), { ...won, climbed: 1 })).toBe(true);
    expect(featDone(DEFAULT_RULES, kind('tower'), won)).toBe(false);
    expect(featDone(DEFAULT_RULES, kind('fire'), { ...won, burned: ['gate:g'] })).toBe(true);
    const captain = won.units.find((u) => u.typeKey === 'officer');
    expect(captain).toBeDefined();
    expect(featDone(DEFAULT_RULES, kind('captive'), won)).toBe(true);
    expect(featDone(DEFAULT_RULES, kind('captive'), { ...won, units: won.units.map((u) => (u.id === captain!.id ? { ...u, alive: false } : u)) })).toBe(false);
    expect(bannersOf(CAMPAIGN, DEFAULT_RULES, { ...won, status: 'defenderWon', climbed: 3 }, kind('tower')).feat).toBe(false);
  });

  it('a slow, costly victory wins the castle only; a defeat wins nothing', () => {
    const slow: BattleState = kill({ ...state, status: 'attackerWon', turn: 20, turnLimit: 24 }, CAMPAIGN.banners.maxLosses + 1);
    expect(bannersOf(CAMPAIGN, DEFAULT_RULES, slow)).toEqual({ taken: true, swift: false, spared: false, feat: false });
    expect(bannersOf(CAMPAIGN, DEFAULT_RULES, { ...state, status: 'defenderWon', turn: 5 })).toEqual({ taken: false, swift: false, spared: false, feat: false });
  });

  it('names the heroes who fell (they rest through the next battle)', () => {
    const fallen: BattleState = { ...state, units: state.units.map((u) => (u.typeKey === 'heroEngineer' ? { ...u, alive: false, hp: 0 } : u)) };
    expect(woundedHeroes(ctx, fallen)).toEqual(['heroEngineer']);
    expect(woundedHeroes(ctx, kill(state, 2, 'defender'))).toEqual([]);
  });

  it('finds a battle by id, the tutorial included', () => {
    expect(campaignBattle(CAMPAIGN, 'fortin')).toBe(CAMPAIGN.tutorial);
    expect(campaignBattle(CAMPAIGN, 'haute-garde')?.name).toBe('Haute-Garde');
    expect(campaignBattle(CAMPAIGN, 'nowhere')).toBeNull();
  });
});
