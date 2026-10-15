/**
 * Heroes (J5, ADR-032): validation of heroes.json, the `ability` command (rejections, cooldowns,
 * buffs), the six abilities, the three passive auras, the grave wound and the AI's priority.
 * Every case is a small hand-built scenario on the synthetic castle of siege-fixture.ts (curtain
 * at x = 20, moat x 10..13, clear weather at the default noon hour), with a ditch declared as a
 * moat so that the sappers' slots exist, and a Field patch in the courtyard for the fire.
 */
import { describe, expect, it } from 'vitest';
import {
  RulesValidationError,
  TerrainLayer,
  applyCommand,
  createBattle,
  createBattleContext,
  createTerrainData,
  decideUnit,
  hashBattleState,
  moraleAfterBlows,
  moraleAfterCollapse,
  moraleStanding,
  previewAttack,
  replay,
  setHeightAtCorner,
  validateRules,
  AI_WEIGHTS,
  type BattleContext,
  type BattleState,
  type Command,
  type CommandRejection,
  type GameEvent,
  type GameRules,
  type RawRuleFiles,
  type Scenario,
  type UnitSpawn,
  type UnitState,
  type Vec2,
} from '@core/index.ts';
import { shotConditions } from '@core/battle/conditions.ts';
import { fireRound } from '@core/battle/fire.ts';
import { abilityCost, previewAbility } from '@core/battle/heroes.ts';
import { fillSiteId, type MoatInfo } from '@core/battle/moat.ts';
import { workState } from '@core/battle/siege-works.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import heroesJson from '@data/heroes.json' with { type: 'json' };
import { centerOf, fillRect, rawRuleFiles } from './helpers.ts';
import { IDS, MAP_D, MAP_W, MOAT_X0, MOAT_X1, WALL_X, buildFixture, spawn, withUnit } from './siege-fixture.ts';

const D = DEFAULT_RULES.damage;
const M = DEFAULT_RULES.morale;
const S = DEFAULT_RULES.structures;
const F = DEFAULT_RULES.fire;
const H = DEFAULT_RULES.heroes;
const SEED = 'heroes';
/** Float comparison precision (digits) for hit chances. */
const PRECISION = 9;

const AUDE = 'att-aude';
const BERTRAND = 'att-bertrand';
const GUILLAUME = 'att-guillaume';
const ARCHER = 'att-archer';
const SOLDIER = 'att-soldier';
const CATAPULT = 'att-cat';
const TARGET = 'def-target';
/** The type of the defender target of the shots. */
const TARGET_TYPE = 'wallGuard';
const DEF_FAR = 'def-far';

const ABILITY = {
  volley: H['heroArcher']!.abilities[0]!,
  pierce: H['heroArcher']!.abilities[1]!,
  calibrate: H['heroEngineer']!.abilities[0]!,
  rush: H['heroEngineer']!.abilities[1]!,
  rally: H['heroKnight']!.abilities[0]!,
  charge: H['heroKnight']!.abilities[1]!,
};
const PASSIVE = {
  eagleEye: H['heroArcher']!.passive,
  masterBuilder: H['heroEngineer']!.passive,
  steadfast: H['heroKnight']!.passive,
};

/** Row of the work sites (slot 1 of the loop) and the ditch geometry, as in siege-works.test.ts. */
const ROW = 5;
const DITCH_DEPTH_M = -1;
const LOOP_FAR_M = 500;
const MOAT_ID = 'moat-test';
const MOAT_CENTRE_X = (MOAT_X0 + MOAT_X1 + 1) / 2;
const MOAT: MoatInfo = {
  id: MOAT_ID,
  centerline: [
    { x: MOAT_CENTRE_X, z: -2 },
    { x: MOAT_CENTRE_X, z: MAP_D + 2 },
    { x: -LOOP_FAR_M, z: MAP_D + 2 },
    { x: -LOOP_FAR_M, z: -2 },
    { x: MOAT_CENTRE_X, z: -2 },
  ],
  widthM: MOAT_X1 - MOAT_X0 + 1,
  sillM: 0,
};
const SITE = fillSiteId(MOAT_ID, 1);
const FIELD = { x0: 40, z0: 2, x1: 49, z1: 9 };
/** A rubble cell: partial cover for the target of a shot. */
const RUBBLE = { x: 18, z: 12 };
/** A crosswind at full strength (blowing along z) for the artillery tests. */
const GALE = { x: 0, z: 1, strength: 1 };
/** A shot's far target, beyond everyone's reach of the heroes' auras. */
const FAR_SHOT = { x: 40, z: 6 };

const pt = (x: number, z: number): Vec2 => centerOf(x, z);

function world(units: UnitSpawn[], rules: GameRules = DEFAULT_RULES, scenarioPatch: Partial<Scenario> = {}): { ctx: BattleContext; scenario: Scenario; state: BattleState } {
  const f = buildFixture(rules, units);
  const t = createTerrainData(MAP_W, MAP_D, 1);
  t.layers.set(f.ctx.baseTerrain.layers);
  t.heights.fill(0);
  for (let iz = 0; iz <= MAP_D; iz++) for (let ix = MOAT_X0; ix <= MOAT_X1 + 1; ix++) setHeightAtCorner(t, ix, iz, DITCH_DEPTH_M);
  fillRect(t, MOAT_X0, 0, MOAT_X1, MAP_D - 1, TerrainLayer.Moat);
  fillRect(t, FIELD.x0, FIELD.z0, FIELD.x1, FIELD.z1, TerrainLayer.Field);
  fillRect(t, RUBBLE.x, RUBBLE.z, RUBBLE.x, RUBBLE.z, TerrainLayer.Rubble);
  const ctx = createBattleContext(t, rules, f.ctx.baseDeck, f.defs, [MOAT]);
  const scenario: Scenario = { ...f.scenario, ...scenarioPatch };
  return { ctx, scenario, state: createBattle(ctx, SEED, scenario) };
}

/** The usual cast: the three heroes, an archer, a soldier, a catapult, two defenders. */
function cast(extra: UnitSpawn[] = []): UnitSpawn[] {
  return [
    spawn(AUDE, 'heroArcher', 16, 6),
    spawn(ARCHER, 'archer', 16, 8),
    spawn(SOLDIER, 'soldier', 17, 6),
    spawn(CATAPULT, 'catapult', 15, 6),
    spawn(BERTRAND, 'heroEngineer', 15, 3),
    spawn(GUILLAUME, 'heroKnight', 18, 3),
    spawn(TARGET, TARGET_TYPE, RUBBLE.x, RUBBLE.z),
    spawn(DEF_FAR, 'militia', 60, 15),
    ...extra,
  ];
}

const unitOf = (state: BattleState, id: string): UnitState => {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};

function run(ctx: BattleContext, state: BattleState, ...commands: Command[]): { state: BattleState; events: GameEvent[]; rejections: (CommandRejection | null)[] } {
  let s = state;
  const events: GameEvent[] = [];
  const rejections: (CommandRejection | null)[] = [];
  for (const c of commands) {
    const r = applyCommand(ctx, s, c);
    s = r.state;
    events.push(...r.events);
    rejections.push(r.rejection);
  }
  return { state: s, events, rejections };
}

const ability = (unitId: string, abilityId: string, rest: { targetId?: string; at?: Vec2; structureId?: string } = {}): Command => ({ type: 'ability', unitId, abilityId, ...rest });
const reject = (ctx: BattleContext, state: BattleState, c: Command): CommandRejection | null => applyCommand(ctx, state, c).rejection;
const END: Command = { type: 'endTurn' };
/** A full round: the attackers end, the defenders end; the attackers' turn starts again. */
const ROUND: Command[] = [END, END];

function attackPreview(ctx: BattleContext, state: BattleState, attacker: string, target: string) {
  const r = previewAttack(ctx, state, attacker, target);
  if (!r.ok) throw new Error(`preview ${attacker} -> ${target}: ${r.reason}`);
  return r.preview;
}

/** Rules (heroes included) where every blow hits and nothing is critical. */
function sureRules(): GameRules {
  const raw = { ...rawRuleFiles(), heroes: heroesJson } as RawRuleFiles;
  Object.assign(raw.damage as Record<string, unknown>, { hitChanceMin: 1, hitChanceMax: 1, critChance: 0 });
  return validateRules(raw);
}

function abilityAttack(ctx: BattleContext, state: BattleState, unitId: string, abilityId: string, targetId: string) {
  const r = previewAbility(ctx, state, { type: 'ability', unitId, abilityId, targetId });
  if (!r.ok || r.preview.kind !== 'attack') throw new Error('expected an attack preview');
  return r.preview.attack;
}

describe('heroes.json validation', () => {
  const rawWith = (patch: (heroes: Record<string, Record<string, unknown>>) => void): RawRuleFiles => {
    const raw = { ...rawRuleFiles(), heroes: structuredClone(heroesJson) } as RawRuleFiles & { heroes: { heroes: Record<string, Record<string, unknown>> } };
    patch(raw.heroes.heroes);
    return raw;
  };
  const failure = (raw: RawRuleFiles): RulesValidationError => {
    try {
      validateRules(raw);
    } catch (err) {
      expect(err).toBeInstanceOf(RulesValidationError);
      return err as RulesValidationError;
    }
    throw new Error('expected validateRules to throw');
  };

  it('DEFAULT_RULES has three heroes, each with two abilities and one passive', () => {
    expect(Object.keys(H).sort()).toEqual(['heroArcher', 'heroEngineer', 'heroKnight']);
    for (const hero of Object.values(H)) {
      expect(hero.abilities).toHaveLength(2);
      expect(hero.passive.id).toBeTruthy();
      expect(DEFAULT_RULES.units[hero.typeKey]?.tags).toContain('hero');
    }
    expect(H['heroArcher']!.abilities.map((a) => a.id)).toEqual(['volley', 'piercingShot']);
    expect(H['heroEngineer']!.abilities.map((a) => a.id)).toEqual(['calibrate', 'rushWorks']);
    expect(H['heroKnight']!.abilities.map((a) => a.id)).toEqual(['rally', 'heroicCharge']);
  });

  it('without a heroes file, heroes is empty', () => {
    expect(validateRules(rawRuleFiles()).heroes).toEqual({});
  });

  it('rejects a hero whose unit type does not exist', () => {
    const err = failure(rawWith((h) => { h['ghost'] = h['heroArcher']!; }));
    expect(err.message).toContain('heroes.heroes.ghost');
  });

  it('rejects a hero whose unit type lacks the "hero" tag', () => {
    const err = failure(rawWith((h) => { h['archer'] = h['heroArcher']!; }));
    expect(err.message).toContain('hero');
    expect(err.message).toContain('heroes.heroes.archer');
  });

  it('rejects an unknown ability id, with its path', () => {
    const err = failure(rawWith((h) => { ((h['heroArcher']!['abilities'] as Record<string, unknown>[])[0] as Record<string, unknown>)['id'] = 'fireball'; }));
    expect(err.message).toContain('heroes.heroes.heroArcher.abilities[0].id');
  });

  it('rejects a number of abilities other than two', () => {
    expect(failure(rawWith((h) => { (h['heroKnight']!['abilities'] as unknown[]).pop(); })).message).toContain('abilities');
    expect(failure(rawWith((h) => { (h['heroKnight']!['abilities'] as unknown[]).push((h['heroKnight']!['abilities'] as unknown[])[0]); })).message).toContain('abilities');
  });
});

describe('ability: rejections', () => {
  const { ctx, state } = world(cast());

  it('notAHero, unknownAbility', () => {
    expect(reject(ctx, state, ability(SOLDIER, 'volley'))).toBe('notAHero');
    expect(reject(ctx, state, ability(AUDE, 'rally'))).toBe('unknownAbility');
    expect(reject(ctx, state, ability(AUDE, 'nope'))).toBe('unknownAbility');
  });

  it('unknownUnit and unitDead come first', () => {
    expect(reject(ctx, state, ability('nobody', 'volley'))).toBe('unknownUnit');
    expect(reject(ctx, withUnit(state, AUDE, { alive: false }), ability(AUDE, 'volley'))).toBe('unitDead');
  });

  it('abilityCooling: a second use is refused, and the state is untouched', () => {
    const once = applyCommand(ctx, state, ability(AUDE, 'volley'));
    expect(once.rejection).toBeNull();
    const twice = applyCommand(ctx, once.state, ability(AUDE, 'volley'));
    expect(twice.rejection).toBe('abilityCooling');
    expect(twice.state).toBe(once.state);
  });

  it('insufficientAp: for the abilities that cost AP', () => {
    const tired = withUnit(state, AUDE, { ap: ABILITY.volley.apCost - 1 });
    expect(reject(ctx, tired, ability(AUDE, 'volley'))).toBe('insufficientAp');
    expect(reject(ctx, withUnit(state, GUILLAUME, { ap: 0 }), ability(GUILLAUME, 'rally'))).toBe('insufficientAp');
    expect(reject(ctx, withUnit(state, BERTRAND, { ap: 0 }), ability(BERTRAND, 'calibrate', { targetId: CATAPULT }))).toBe('insufficientAp');
    // The shot costs the attack plus the ability's own AP.
    expect(reject(ctx, withUnit(state, AUDE, { ap: D.attackApCost }), ability(AUDE, 'piercingShot', { targetId: TARGET }))).toBe('insufficientAp');
  });

  it('invalidAbilityTarget: calibrate on a soldier, an enemy or nobody; shots without a target; works without a site', () => {
    expect(reject(ctx, state, ability(BERTRAND, 'calibrate', { targetId: SOLDIER }))).toBe('invalidAbilityTarget');
    expect(reject(ctx, state, ability(BERTRAND, 'calibrate', { targetId: TARGET }))).toBe('invalidAbilityTarget');
    expect(reject(ctx, state, ability(BERTRAND, 'calibrate'))).toBe('invalidAbilityTarget');
    expect(reject(ctx, withUnit(state, CATAPULT, { alive: false }), ability(BERTRAND, 'calibrate', { targetId: CATAPULT }))).toBe('invalidAbilityTarget');
    expect(reject(ctx, state, ability(AUDE, 'piercingShot'))).toBe('invalidAbilityTarget');
    expect(reject(ctx, state, ability(GUILLAUME, 'heroicCharge'))).toBe('invalidAbilityTarget');
    expect(reject(ctx, state, ability(BERTRAND, 'rushWorks'))).toBe('invalidAbilityTarget');
  });

  it('outOfRange: calibrate beyond radiusM (and exactly at radiusM is fine)', () => {
    const bertrand = unitOf(state, BERTRAND).position;
    const catapultAt = (dz: number) => withUnit(state, CATAPULT, { position: { x: bertrand.x, z: bertrand.z + dz } });
    expect(reject(ctx, catapultAt(ABILITY.calibrate.radiusM), ability(BERTRAND, 'calibrate', { targetId: CATAPULT }))).toBeNull();
    expect(reject(ctx, catapultAt(ABILITY.calibrate.radiusM + 1), ability(BERTRAND, 'calibrate', { targetId: CATAPULT }))).toBe('outOfRange');
  });

  it('unitFleeing: a fleeing hero takes no orders', () => {
    expect(reject(ctx, withUnit(state, AUDE, { morale: M.fleeBelow - 1 }), ability(AUDE, 'volley'))).toBe('unitFleeing');
  });

  it('notYourTurn: after the attackers end their turn', () => {
    const theirs = run(ctx, state, END).state;
    expect(reject(ctx, theirs, ability(AUDE, 'volley'))).toBe('notYourTurn');
  });

  it('the preview shares the checks of the command', () => {
    expect(previewAbility(ctx, state, { type: 'ability', unitId: SOLDIER, abilityId: 'volley' })).toEqual({ ok: false, reason: 'notAHero' });
    expect(previewAbility(ctx, state, { type: 'ability', unitId: AUDE, abilityId: 'volley' }).ok).toBe(true);
  });
});

describe('abilityCost: what the card tells is what the rules take', () => {
  const adjacent = spawn('def-adj', TARGET_TYPE, 19, 3);
  const nearDitch = [spawn(BERTRAND, 'heroEngineer', MOAT_X1 + 2, ROW), spawn(DEF_FAR, 'militia', 60, 15)];
  const cases: readonly { readonly id: string; readonly hero: string; readonly units: UnitSpawn[]; readonly rest?: { targetId?: string; at?: Vec2 } }[] = [
    { id: 'volley', hero: AUDE, units: cast() },
    { id: 'piercingShot', hero: AUDE, units: cast(), rest: { targetId: TARGET } },
    { id: 'calibrate', hero: BERTRAND, units: cast(), rest: { targetId: CATAPULT } },
    { id: 'rushWorks', hero: BERTRAND, units: nearDitch, rest: { at: pt(MOAT_X0 + 1, ROW) } },
    { id: 'rally', hero: GUILLAUME, units: cast() },
    { id: 'heroicCharge', hero: GUILLAUME, units: cast([adjacent]), rest: { targetId: 'def-adj' } },
  ];
  const rule = (id: string) => Object.values(H).flatMap((h) => h.abilities).find((a) => a.id === id);

  it('covers every ability of the rules', () => {
    expect(cases.map((c) => c.id).sort()).toEqual(Object.values(H).flatMap((h) => h.abilities.map((a) => a.id)).sort());
  });

  for (const c of cases) {
    it(`${c.id}: the points of action and the deed of the turn it takes`, () => {
      const a = rule(c.id);
      if (!a) throw new Error(`no ability ${c.id}`);
      const cost = abilityCost(DEFAULT_RULES, a);
      const { ctx, state } = world(c.units);
      const r = run(ctx, state, ability(c.hero, c.id, c.rest));
      expect(r.rejections).toEqual([null]);
      const before = unitOf(state, c.hero);
      const after = unitOf(r.state, c.hero);
      expect(before.ap - after.ap).toBe(cost.wholeTurn ? before.ap : cost.ap);
      expect(before.actions - after.actions).toBe(cost.deed ? before.actions : 0);
      // Refused short of its points of action, or (for a deed) once the turn's deed is spent.
      expect(reject(ctx, withUnit(state, c.hero, { ap: cost.ap - 1 }), ability(c.hero, c.id, c.rest))).toBe('insufficientAp');
      if (cost.deed) expect(reject(ctx, withUnit(state, c.hero, { actions: 0 }), ability(c.hero, c.id, c.rest))).toBe('noActionLeft');
      else expect(reject(ctx, withUnit(state, c.hero, { actions: 0 }), ability(c.hero, c.id, c.rest))).toBeNull();
    });
  }
});

describe('Volée (volley)', () => {
  const units = cast([spawn('att-archer-far', 'archer', 16, MAP_D - 1), spawn('att-archer-edge', 'archer', 16 + 1, 6 + ABILITY.volley.radiusM - 1)]);
  const { ctx, state } = world(units);
  const volley = run(ctx, state, ability(AUDE, 'volley'));

  it('buffs Aude and the shooters within radiusM, not the infantry, the engines, the far archers or the enemy', () => {
    expect(volley.rejections).toEqual([null]);
    const buffed = (id: string) => unitOf(volley.state, id).buffs?.map((b) => b.source);
    expect(buffed(AUDE)).toEqual(['volley']);
    expect(buffed(ARCHER)).toEqual(['volley']);
    expect(buffed(SOLDIER)).toBeUndefined();
    expect(buffed(CATAPULT)).toBeUndefined();
    expect(buffed('att-archer-far')).toBeUndefined();
    expect(buffed(TARGET)).toBeUndefined();
    expect(unitOf(volley.state, ARCHER).buffs?.[0]).toEqual({ source: 'volley', accuracy: ABILITY.volley.accuracyBonus, windImmune: false });
    expect(volley.events).toContainEqual(expect.objectContaining({ type: 'abilityUsed', unitId: AUDE, abilityId: 'volley' }));
  });

  it('a shooter just inside radiusM is buffed', () => {
    expect(unitOf(volley.state, 'att-archer-edge').buffs).toBeDefined();
  });

  it('costs apCost AP and starts the cooldown', () => {
    expect(unitOf(volley.state, AUDE).ap).toBe(unitOf(state, AUDE).ap - ABILITY.volley.apCost);
    expect(unitOf(volley.state, AUDE).cooldowns).toEqual({ volley: ABILITY.volley.cooldown });
    expect(unitOf(volley.state, ARCHER).ap).toBe(unitOf(state, ARCHER).ap);
  });

  it("raises an archer's hit chance by exactly accuracyBonus, and says so in the preview", () => {
    const before = attackPreview(ctx, state, ARCHER, TARGET);
    const after = attackPreview(ctx, volley.state, ARCHER, TARGET);
    expect(after.blow.hitChance - before.blow.hitChance).toBeCloseTo(ABILITY.volley.accuracyBonus, PRECISION);
    expect(after.conditions).toContainEqual({ kind: 'hero', source: 'volley', accuracy: ABILITY.volley.accuracyBonus, rangeFactor: 1 });
    expect(before.conditions.some((c) => c.source === 'volley')).toBe(false);
  });

  it("the buff ends with the side's turn", () => {
    const next = run(ctx, volley.state, END).state;
    expect(next.units.every((u) => u.buffs === undefined)).toBe(true);
    const back = run(ctx, volley.state, ...ROUND).state;
    expect(attackPreview(ctx, back, ARCHER, TARGET).conditions.some((c) => c.source === 'volley')).toBe(false);
  });

  it("the cooldown ticks down at the start of each of the attackers' turns and the ability returns after `cooldown` rounds", () => {
    let s = volley.state;
    for (let round = 1; round < ABILITY.volley.cooldown; round++) {
      s = run(ctx, s, ...ROUND).state;
      expect(unitOf(s, AUDE).cooldowns).toEqual({ volley: ABILITY.volley.cooldown - round });
      expect(reject(ctx, s, ability(AUDE, 'volley'))).toBe('abilityCooling');
    }
    // The defenders' turn does not count.
    const defenders = run(ctx, s, END).state;
    expect(unitOf(defenders, AUDE).cooldowns).toEqual(unitOf(s, AUDE).cooldowns);
    s = run(ctx, s, ...ROUND).state;
    expect(unitOf(s, AUDE).cooldowns).toBeUndefined();
    expect(reject(ctx, s, ability(AUDE, 'volley'))).toBeNull();
  });
});

describe('Flèche perçante (piercingShot)', () => {
  const { ctx, state } = world(cast());
  const piercing = ability(AUDE, 'piercingShot', { targetId: TARGET });

  it('ignores cover and armour', () => {
    const normal = attackPreview(ctx, state, AUDE, TARGET);
    expect(normal.cover).not.toBe('none');
    const a = abilityAttack(ctx, state, AUDE, 'piercingShot', TARGET);
    const power = DEFAULT_RULES.units['heroArcher']!.attack!.power;
    const armor = DEFAULT_RULES.units[TARGET_TYPE]!.armor;
    expect(a.cover).toBe('none');
    expect(a.blow.hitChance).toBeGreaterThan(normal.blow.hitChance);
    expect(a.blow.damage.min).toBe(Math.round(power * D.multipliers.piercing[armor]));
    expect(a.blow.damage.max).toBe(Math.round(power * D.multipliers.piercing[armor] * D.critMultiplier));
    expect(normal.blow.damage.min).toBe(Math.round(power * (1 - D.armorReduction[armor]) * D.multipliers.piercing[armor]));
    expect(a.blow.damage.min).toBeGreaterThan(normal.blow.damage.min);
  });

  it('spends the action, attackApCost + apCost AP, and starts the cooldown', () => {
    const r = run(ctx, state, piercing);
    expect(r.rejections).toEqual([null]);
    const aude = unitOf(r.state, AUDE);
    expect(aude.actions).toBe(unitOf(state, AUDE).actions - 1);
    expect(aude.ap).toBe(unitOf(state, AUDE).ap - D.attackApCost - ABILITY.pierce.apCost);
    expect(aude.cooldowns).toEqual({ piercingShot: ABILITY.pierce.cooldown });
    expect(r.events.map((e) => e.type).slice(0, 2)).toEqual(['abilityUsed', 'unitAttacked']);
    expect(reject(ctx, r.state, piercing)).toBe('abilityCooling');
  });

  it('is refused without an action left', () => {
    expect(reject(ctx, withUnit(state, AUDE, { actions: 0 }), piercing)).toBe('noActionLeft');
  });
});

describe('Assaut du preux (heroicCharge)', () => {
  const adjacent = spawn('def-adj', TARGET_TYPE, 19, 3);
  const { ctx, state: base } = world(cast([adjacent]));

  it('adds accuracyBonus, multiplies the damage by damageFactor and takes away the riposte', () => {
    const normal = attackPreview(ctx, base, GUILLAUME, 'def-adj');
    expect(normal.riposte).not.toBeNull();
    const a = abilityAttack(ctx, base, GUILLAUME, 'heroicCharge', 'def-adj');
    expect(a.blow.hitChance - normal.blow.hitChance).toBeCloseTo(ABILITY.charge.accuracyBonus, PRECISION);
    const power = DEFAULT_RULES.units['heroKnight']!.attack!.power;
    const armor = DEFAULT_RULES.units[TARGET_TYPE]!.armor;
    expect(a.blow.damage.min).toBe(Math.round(power * (1 - D.armorReduction[armor]) * D.multipliers.blunt[armor] * ABILITY.charge.damageFactor));
    expect(a.blow.damage.min).toBeGreaterThan(normal.blow.damage.min);
    expect(a.riposte).toBeNull();
    expect(a.apCost).toBe(D.attackApCost + ABILITY.charge.apCost);
  });

  it('resolves as a single blow with no riposte, an action spent and a cooldown', () => {
    const w = world(cast([adjacent]), sureRules());
    const r = run(w.ctx, w.state, ability(GUILLAUME, 'heroicCharge', { targetId: 'def-adj' }));
    expect(r.rejections).toEqual([null]);
    expect(r.events.filter((e) => e.type === 'unitAttacked')).toHaveLength(1);
    expect(unitOf(r.state, GUILLAUME).hp).toBe(unitOf(w.state, GUILLAUME).hp);
    expect(unitOf(r.state, 'def-adj').hp).toBeLessThan(unitOf(w.state, 'def-adj').hp);
    expect(unitOf(r.state, GUILLAUME).actions).toBe(0);
    expect(unitOf(r.state, GUILLAUME).cooldowns).toEqual({ heroicCharge: ABILITY.charge.cooldown });
  });
});

describe('Coup juste (calibrate)', () => {
  const { ctx, state: calm } = world(cast([spawn('def-dist', 'militia', FAR_SHOT.x, FAR_SHOT.z)]));
  const state: BattleState = { ...calm, wind: GALE };
  const calibrated = run(ctx, state, ability(BERTRAND, 'calibrate', { targetId: CATAPULT }));

  it('the catapult no longer suffers the crosswind and gains accuracyBonus', () => {
    expect(calibrated.rejections).toEqual([null]);
    const before = attackPreview(ctx, state, CATAPULT, 'def-dist');
    const after = attackPreview(ctx, calibrated.state, CATAPULT, 'def-dist');
    const wind = before.conditions.find((c) => c.kind === 'wind');
    expect(wind).toBeDefined();
    expect(after.conditions.some((c) => c.kind === 'wind')).toBe(false);
    expect(after.conditions).toContainEqual({ kind: 'hero', source: 'calibrate', accuracy: ABILITY.calibrate.accuracyBonus, rangeFactor: 1 });
    expect(after.blow.hitChance - before.blow.hitChance).toBeCloseTo(ABILITY.calibrate.accuracyBonus - (wind?.accuracy ?? 0), PRECISION);
    expect(unitOf(calibrated.state, CATAPULT).buffs).toEqual([{ source: 'calibrate', accuracy: ABILITY.calibrate.accuracyBonus, windImmune: true }]);
    const shooter = unitOf(calibrated.state, CATAPULT);
    expect(shotConditions(ctx, calibrated.state, shooter.position, pt(FAR_SHOT.x, FAR_SHOT.z), true, shooter).modifiers.some((m) => m.kind === 'wind')).toBe(false);
  });

  it('only the target engine is buffed; Bertrand pays the AP and the cooldown', () => {
    expect(calibrated.state.units.filter((u) => u.buffs).map((u) => u.id)).toEqual([CATAPULT]);
    expect(unitOf(calibrated.state, BERTRAND).ap).toBe(unitOf(state, BERTRAND).ap - ABILITY.calibrate.apCost);
    expect(unitOf(calibrated.state, BERTRAND).cooldowns).toEqual({ calibrate: ABILITY.calibrate.cooldown });
  });

  it('wears off at the end of the turn', () => {
    const next = run(ctx, calibrated.state, END).state;
    expect(unitOf(next, CATAPULT).buffs).toBeUndefined();
  });
});

describe('Double besogne (rushWorks)', () => {
  const engineerAt = (x: number, z: number) => [spawn(BERTRAND, 'heroEngineer', x, z), spawn(DEF_FAR, 'militia', 60, 15), spawn('def-near', 'militia', 30, 3)];
  const ditch = pt(MOAT_X0 + 1, ROW);

  it('fills a moat slot of two turns in one go: two progress events and the moat filled', () => {
    const { ctx, state } = world(engineerAt(MOAT_X1 + 2, ROW));
    const r = run(ctx, state, ability(BERTRAND, 'rushWorks', { at: ditch }));
    expect(r.rejections).toEqual([null]);
    const progress = r.events.filter((e) => e.type === 'siegeWorkProgressed');
    expect(progress).toHaveLength(ABILITY.rush.workFactor);
    expect(progress.map((e) => (e.type === 'siegeWorkProgressed' ? e.progress : -1))).toEqual([1, 2]);
    expect(workState(r.state, SITE)).toEqual({ id: SITE, progress: S.fillTurns, done: true });
    expect(r.events.filter((e) => e.type === 'moatFilled')).toHaveLength(1);
    expect(unitOf(r.state, BERTRAND).cooldowns).toEqual({ rushWorks: ABILITY.rush.cooldown });
    expect(reject(ctx, r.state, ability(BERTRAND, 'rushWorks', { at: ditch }))).toBe('abilityCooling');
  });

  it('stops at the end of the work: a slot at fillTurns - 1 gets a single event', () => {
    const { ctx, state } = world(engineerAt(MOAT_X1 + 2, ROW));
    const half = { ...state, works: [{ id: SITE, progress: S.fillTurns - 1, done: false }] };
    const r = run(ctx, half, ability(BERTRAND, 'rushWorks', { at: ditch }));
    expect(r.events.filter((e) => e.type === 'siegeWorkProgressed')).toHaveLength(1);
    expect(workState(r.state, SITE)?.done).toBe(true);
  });

  it('undermines a wall by two turns at once (mineTurns is 3, so the work is not done)', () => {
    const { ctx, state } = world(engineerAt(WALL_X - 1, 5));
    const r = run(ctx, state, ability(BERTRAND, 'rushWorks', { structureId: IDS.wallA }));
    expect(r.rejections).toEqual([null]);
    expect(r.events.filter((e) => e.type === 'siegeWorkProgressed')).toHaveLength(ABILITY.rush.workFactor);
    expect(workState(r.state, `mine:${IDS.wallA}`)).toMatchObject({ progress: ABILITY.rush.workFactor, done: false });
    expect(S.mineTurns).toBeGreaterThan(ABILITY.rush.workFactor);
  });

  it('refuses a site out of reach', () => {
    const { ctx, state } = world(engineerAt(2, ROW));
    expect(reject(ctx, state, ability(BERTRAND, 'rushWorks', { at: ditch }))).toBe('outOfRange');
    expect(reject(ctx, state, ability(BERTRAND, 'rushWorks', { structureId: IDS.wallA }))).toBe('outOfRange');
  });
});

describe('Ralliement (rally)', () => {
  const GUILLAUME_X = 18;
  const { ctx, state: base } = world(
    cast([
      spawn('att-near', 'soldier', 16, 3),
      spawn('att-edge', 'soldier', GUILLAUME_X + ABILITY.rally.radiusM - 1, 3),
      spawn('att-out', 'soldier', GUILLAUME_X + ABILITY.rally.radiusM + 2, 3),
    ]),
  );
  const LOW = 50;
  const NEAR_MAX = M.max - 10;
  const state = (
    [
      ['att-near', LOW],
      ['att-edge', NEAR_MAX],
      ['att-out', LOW],
      [SOLDIER, M.fleeBelow - 10],
      [GUILLAUME, M.max],
    ] as const
  ).reduce((s, [id, morale]) => withUnit(s, id, { morale }), base);
  const r = run(ctx, state, ability(GUILLAUME, 'rally'));

  it('gives moraleGain (up to max) to allies within radiusM, with the reason rally', () => {
    expect(r.rejections).toEqual([null]);
    expect(unitOf(r.state, 'att-near').morale).toBe(LOW + ABILITY.rally.moraleGain);
    expect(unitOf(r.state, 'att-edge').morale).toBe(M.max);
    expect(r.events).toContainEqual({ type: 'moraleChanged', unitId: 'att-near', morale: LOW + ABILITY.rally.moraleGain, delta: ABILITY.rally.moraleGain, reason: 'rally' });
    expect(r.events).toContainEqual({ type: 'moraleChanged', unitId: 'att-edge', morale: M.max, delta: M.max - NEAR_MAX, reason: 'rally' });
  });

  it('leaves alone the allies out of reach, the enemies and the ones already at max', () => {
    expect(unitOf(r.state, 'att-out').morale).toBe(LOW);
    expect(unitOf(r.state, TARGET).morale).toBe(unitOf(state, TARGET).morale);
    expect(r.events.some((e) => e.type === 'moraleChanged' && (e.unitId === GUILLAUME || e.unitId === 'att-out'))).toBe(false);
  });

  it('a fleeing ally is steady again', () => {
    expect(moraleStanding(M, unitOf(state, SOLDIER).morale)).toBe('fleeing');
    expect(moraleStanding(M, unitOf(r.state, SOLDIER).morale)).toBe('steady');
  });

  it('costs apCost AP and starts the cooldown', () => {
    expect(unitOf(r.state, GUILLAUME).ap).toBe(unitOf(state, GUILLAUME).ap - ABILITY.rally.apCost);
    expect(unitOf(r.state, GUILLAUME).cooldowns).toEqual({ rally: ABILITY.rally.cooldown });
  });
});

describe('passives', () => {
  it("Œil d'aigle: +accuracyBonus for an archer within radiusM of Aude, nothing beyond", () => {
    // Aude stands at z = 6; the archer is lined up on her column, inside or outside the aura.
    const archerAt = (dz: number) => world(cast([spawn('att-eye', 'archer', 16, 6 + dz)]));
    const near = archerAt(PASSIVE.eagleEye.radiusM - 1);
    const out = archerAt(PASSIVE.eagleEye.radiusM + 1);
    const preview = (w: typeof near) => attackPreview(w.ctx, w.state, 'att-eye', TARGET);
    expect(preview(near).conditions).toContainEqual({ kind: 'hero', source: 'eagleEye', accuracy: PASSIVE.eagleEye.accuracyBonus, rangeFactor: 1 });
    expect(preview(out).conditions.some((c) => c.source === 'eagleEye')).toBe(false);
  });

  it("Œil d'aigle does not help infantry or engines, and a dead Aude gives nothing", () => {
    const { ctx, state } = world(cast());
    const target = pt(FAR_SHOT.x, FAR_SHOT.z);
    const mods = (s: BattleState, id: string) => shotConditions(ctx, s, unitOf(s, id).position, target, id === CATAPULT, unitOf(s, id)).modifiers;
    expect(mods(state, SOLDIER).some((m) => m.source === 'eagleEye')).toBe(false);
    expect(mods(state, CATAPULT).some((m) => m.source === 'eagleEye')).toBe(false);
    expect(mods(state, ARCHER).some((m) => m.source === 'eagleEye')).toBe(true);
    expect(mods(withUnit(state, AUDE, { alive: false }), ARCHER).some((m) => m.source === 'eagleEye')).toBe(false);
  });

  it("Maître d'œuvre: +accuracyBonus for a catapult within radiusM of Bertrand, nothing beyond or for archers", () => {
    const { ctx, state } = world(cast());
    const target = pt(FAR_SHOT.x, FAR_SHOT.z);
    const catapultMods = (s: BattleState) => shotConditions(ctx, s, unitOf(s, CATAPULT).position, target, true, unitOf(s, CATAPULT)).modifiers;
    expect(catapultMods(state)).toContainEqual({ kind: 'hero', source: 'masterBuilder', accuracy: PASSIVE.masterBuilder.accuracyBonus, rangeFactor: 1 });
    const bertrand = unitOf(state, BERTRAND).position;
    const away = withUnit(state, CATAPULT, { position: { x: bertrand.x, z: bertrand.z + PASSIVE.masterBuilder.radiusM + 1 } });
    expect(catapultMods(away).some((m) => m.source === 'masterBuilder')).toBe(false);
    const archer = unitOf(state, ARCHER);
    expect(shotConditions(ctx, state, archer.position, target, false, archer).modifiers.some((m) => m.source === 'masterBuilder')).toBe(false);
  });

  describe('Fermeté: morale losses halved within radiusM of Guillaume', () => {
    // Guillaume stands at (18, 3): `near` is inside the radius, `out` and `victim` outside.
    const NEAR_DZ = PASSIVE.steadfast.radiusM - 2;
    const OUT_DZ = PASSIVE.steadfast.radiusM + 2;
    const { ctx, state } = world(cast([spawn('att-near', 'soldier', 18, 3 + NEAR_DZ), spawn('att-out', 'soldier', 18, 3 + OUT_DZ), spawn('att-victim', 'soldier', 19, 3 + NEAR_DZ)]));
    /** The loss after the aura: shift() rounds the scaled (negative) delta. */
    const halved = (loss: number) => Math.round(-loss * PASSIVE.steadfast.moraleLossFactor);
    const moraleEvent = (events: GameEvent[], id: string) => events.find((e) => e.type === 'moraleChanged' && e.unitId === id);

    it('an ally dying nearby', () => {
      const events: GameEvent[] = [];
      moraleAfterBlows(ctx, state.units, [{ attackerId: TARGET, targetId: 'att-victim', hpBefore: 1, hpAfter: 0 }], events);
      expect(moraleEvent(events, 'att-near')).toMatchObject({ delta: halved(M.allyDeathLoss), reason: 'allyDied' });
      expect(moraleEvent(events, 'att-out')).toMatchObject({ delta: -M.allyDeathLoss, reason: 'allyDied' });
    });

    it('a wall collapsing', () => {
      const events: GameEvent[] = [];
      moraleAfterCollapse(ctx, state.units, unitOf(state, 'att-near').position, 'attacker', events);
      expect(moraleEvent(events, 'att-near')).toMatchObject({ delta: halved(S.collapseMoraleLoss), reason: 'wallCollapsed' });
      expect(moraleEvent(events, 'att-out')).toMatchObject({ delta: -S.collapseMoraleLoss, reason: 'wallCollapsed' });
    });

    it('a fire', () => {
      const w = world([spawn(GUILLAUME, 'heroKnight', 41, 8), spawn('att-near', 'soldier', 44, 8), spawn('att-out', 'soldier', 49, 2), spawn(DEF_FAR, 'militia', 60, 15)]);
      const cell = (x: number, z: number) => z * MAP_W + x;
      const fires = [cell(44, 8), cell(49, 2)].sort((a, b) => a - b).map((c) => ({ cell: c, turnsLeft: F.vegetationTurns }));
      const events: GameEvent[] = [];
      fireRound(w.ctx, { ...w.state, fires }, events);
      expect(moraleEvent(events, 'att-near')).toMatchObject({ delta: halved(F.moraleLoss), reason: 'fire' });
      expect(moraleEvent(events, 'att-out')).toMatchObject({ delta: -F.moraleLoss, reason: 'fire' });
    });

    it('the wounded threshold', () => {
      const events: GameEvent[] = [];
      const woundedHp = DEFAULT_RULES.units['soldier']!.hp * M.woundedHpFraction;
      moraleAfterBlows(ctx, state.units, [{ attackerId: TARGET, targetId: 'att-near', hpBefore: woundedHp + 1, hpAfter: woundedHp }], events);
      expect(moraleEvent(events, 'att-near')).toMatchObject({ delta: halved(M.woundedLoss), reason: 'wounded' });
    });
  });
});

describe('grave wound', () => {
  const sure = sureRules();

  it('a hero at 0 HP is out of the battle (alive false, unitDied) and can no longer act', () => {
    const w = world([spawn(AUDE, 'heroArcher', 16, 6), spawn('def-hit', TARGET_TYPE, 17, 6), spawn(SOLDIER, 'soldier', 16, 9)], sure, { firstFaction: 'defender' });
    const r = run(w.ctx, withUnit(w.state, AUDE, { hp: 1 }), { type: 'attack', unitId: 'def-hit', targetId: AUDE });
    expect(r.rejections).toEqual([null]);
    expect(unitOf(r.state, AUDE)).toMatchObject({ alive: false, hp: 0 });
    expect(r.events).toContainEqual({ type: 'unitDied', unitId: AUDE, byId: 'def-hit' });
    const back = run(w.ctx, r.state, END);
    expect(reject(w.ctx, back.state, ability(AUDE, 'volley'))).toBe('unitDead');
  });

  it('a hero killed by a riposte leaves the battle too', () => {
    // A tough militia-like defender (wallGuard) survives the blow and answers; Guillaume has 1 HP.
    const w = world([spawn(GUILLAUME, 'heroKnight', 16, 6), spawn('def-hit', TARGET_TYPE, 17, 6), spawn(DEF_FAR, 'militia', 60, 15)], sure);
    const r = run(w.ctx, withUnit(w.state, GUILLAUME, { hp: 1 }), { type: 'attack', unitId: GUILLAUME, targetId: 'def-hit' });
    expect(unitOf(r.state, GUILLAUME)).toMatchObject({ alive: false, hp: 0 });
    expect(r.events).toContainEqual({ type: 'unitDied', unitId: GUILLAUME, byId: 'def-hit' });
  });
});

describe('determinism with abilities', () => {
  const { ctx, scenario } = world(cast([spawn('def-adj', TARGET_TYPE, 19, 3)]));
  const commands: Command[] = [
    ability(AUDE, 'volley'),
    { type: 'attack', unitId: ARCHER, targetId: TARGET },
    ability(AUDE, 'piercingShot', { targetId: TARGET }),
    ability(BERTRAND, 'calibrate', { targetId: CATAPULT }),
    ability(BERTRAND, 'rushWorks', { structureId: IDS.wallA }),
    ability(GUILLAUME, 'rally'),
    ability(GUILLAUME, 'heroicCharge', { targetId: 'def-adj' }),
    ...ROUND,
    ability(AUDE, 'volley'),
    END,
  ];

  it('replay gives the same state hash every time and after a JSON round trip of the commands', () => {
    const a = replay(ctx, SEED, scenario, commands);
    const b = replay(ctx, SEED, scenario, commands);
    const c = replay(ctx, SEED, scenario, JSON.parse(JSON.stringify(commands)) as Command[]);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    expect(hashBattleState(a.state)).toBe(hashBattleState(c.state));
    expect(a.events).toEqual(c.events);
  });

  it('the sequence really uses the abilities', () => {
    const a = replay(ctx, SEED, scenario, commands);
    const used = a.events.filter((e) => e.type === 'abilityUsed').length;
    expect(used).toBe(commands.filter((c) => c.type === 'ability').length - a.events.filter((e) => e.type === 'commandRejected').length);
    expect(used).toBeGreaterThanOrEqual(5);
    expect(hashBattleState(a.state)).not.toBe(hashBattleState(replay(ctx, SEED, scenario, ROUND).state));
  });

  it('cooldowns and buffs are part of the state hash', () => {
    const { state } = world(cast());
    const used = applyCommand(ctx, state, ability(AUDE, 'volley')).state;
    expect(hashBattleState(used)).not.toBe(hashBattleState(state));
  });
});

describe('AI: the garrison aims at heroes', () => {
  it('at equal value, a defender shoots the hero rather than an ordinary archer', () => {
    // Two light-armoured archers at mirrored spots: same odds. The ordinary one has the lower id.
    const heroId = 'att-z-hero';
    const plainId = 'att-a-plain';
    const w = world(
      [spawn('def-shooter', 'towerArcher', 16, 10), spawn(plainId, 'archer', 16, 4), spawn(heroId, 'heroArcher', 16, 16), spawn('def-keep', TARGET_TYPE, 60, 15)],
      DEFAULT_RULES,
      { firstFaction: 'defender' },
    );
    expect(AI_WEIGHTS.heroPriority).toBeGreaterThan(1);
    const a = attackPreview(w.ctx, w.state, 'def-shooter', plainId);
    const b = attackPreview(w.ctx, w.state, 'def-shooter', heroId);
    expect(b.blow).toEqual(a.blow);
    const commands = decideUnit(w.ctx, w.state, unitOf(w.state, 'def-shooter'));
    expect(commands.find((c) => c.type === 'attack')).toMatchObject({ type: 'attack', targetId: heroId });
  });
});
