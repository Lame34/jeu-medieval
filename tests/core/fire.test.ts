/**
 * Fire (src/core/battle/fire.ts, commands fireArrow / extinguish): fire arrows, fuel, burns, spread
 * with the wind, extinguishing, the drawbridge and the gate under fire. Built on the synthetic castle
 * of siege-fixture.ts with patches of Field (vegetation) and Road laid on the courtyard.
 */
import { describe, expect, it } from 'vitest';
import {
  TerrainLayer,
  applyCommand,
  createBattle,
  createBattleContext,
  createTerrainData,
  hashBattleState,
  replay,
  validateRules,
  type BattleContext,
  type BattleState,
  type Command,
  type CommandRejection,
  type GameEvent,
  type GameRules,
  type UnitSpawn,
  type Vec2,
} from '@core/index.ts';
import { fireRound, fuelOf, previewExtinguish, previewFireArrow } from '@core/battle/fire.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { IDS, MAP_D, MAP_W, buildFixture, spawn, withUnit } from './siege-fixture.ts';
import { centerOf, fillRect, rawRuleFiles } from './helpers.ts';

const F = DEFAULT_RULES.fire;
const D = DEFAULT_RULES.damage;
const SEED = 'fire-tests';
const ARCHER = 'att-archer';
const SOLDIER = 'att-sold';
/** The Field patch in the courtyard, x 40..49, z 2..9 (nothing stands on it unless a test says so). */
const FIELD = { x0: 40, z0: 2, x1: 49, z1: 9 };
const ROAD_CELL = { x: 36, z: 5 };
const FAR_FIELD = { x: 65, z: 15 };
/** A Field cell right behind the gatehouse, hidden from an archer standing outside the curtain. */
const HIDDEN_FIELD = { x: 26, z: 9 };
const OUTSIDE_ARCHER = { x: 16, z: 9 };
const WEST_ARCHER = { x: 22, z: 2 };
const ARCHER_POS = { x: 36, z: 3 };
/** Cell of the fire in the middle of the field. */
const MID = { x: 44, z: 5 };
const NEW_ROUND: Command[] = [{ type: 'endTurn' }, { type: 'endTurn' }];
const SPREAD_SEEDS = 300;
const NO_SPREAD = { spreadChance: 0, windSpread: 0, spreadMax: 0 };
const SURE_FIRE = { hitChanceMin: 1, hitChanceMax: 1 };

const idx = (x: number, z: number): number => z * MAP_W + x;
const pt = (x: number, z: number): Vec2 => centerOf(x, z);

function rulesWith(fire: Record<string, number> = {}, damage: Record<string, unknown> = {}): GameRules {
  const raw = rawRuleFiles();
  const dmg = raw.damage as { fire: Record<string, number> } & Record<string, unknown>;
  Object.assign(dmg, damage);
  Object.assign(dmg.fire, fire);
  return validateRules(raw);
}

function units(extra: UnitSpawn[] = []): UnitSpawn[] {
  return [
    spawn(ARCHER, 'archer', ARCHER_POS.x, ARCHER_POS.z),
    spawn(SOLDIER, 'soldier', 30, 15),
    spawn(IDS.winch, 'towerArcher', 30, 9),
    spawn('def-far', 'militia', 60, 2),
    ...extra,
  ];
}

function world(rules: GameRules = DEFAULT_RULES, extra: UnitSpawn[] = []): { ctx: BattleContext; state: BattleState; scenario: ReturnType<typeof buildFixture>['scenario'] } {
  const f = buildFixture(rules, units(extra));
  const t = createTerrainData(MAP_W, MAP_D, 1);
  t.layers.set(f.ctx.baseTerrain.layers);
  t.heights.set(f.ctx.baseTerrain.heights);
  fillRect(t, FIELD.x0, FIELD.z0, FIELD.x1, FIELD.z1, TerrainLayer.Field);
  fillRect(t, ROAD_CELL.x, ROAD_CELL.z, ROAD_CELL.x, ROAD_CELL.z, TerrainLayer.Road);
  fillRect(t, FAR_FIELD.x, FAR_FIELD.z, FAR_FIELD.x, FAR_FIELD.z, TerrainLayer.Field);
  fillRect(t, HIDDEN_FIELD.x, HIDDEN_FIELD.z, HIDDEN_FIELD.x, HIDDEN_FIELD.z, TerrainLayer.Field);
  const ctx = createBattleContext(t, rules, f.ctx.baseDeck, f.defs);
  return { ctx, state: createBattle(ctx, SEED, f.scenario), scenario: f.scenario };
}

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

const shoot = (x: number, z: number, unitId = ARCHER): Command => ({ type: 'fireArrow', unitId, at: pt(x, z) });
const douse = (x: number, z: number, unitId = SOLDIER): Command => ({ type: 'extinguish', unitId, at: pt(x, z) });
const rejection = (ctx: BattleContext, state: BattleState, c: Command): CommandRejection | null => applyCommand(ctx, state, c).rejection;
const burning = (state: BattleState, ...cells: number[]): BattleState => ({
  ...state,
  fires: cells.map((cell) => ({ cell, turnsLeft: F.vegetationTurns })).sort((a, b) => a.cell - b.cell),
});
const unitOf = (state: BattleState, id: string) => {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};
const round = (ctx: BattleContext, state: BattleState): { state: BattleState; events: GameEvent[] } => {
  const events: GameEvent[] = [];
  return { state: fireRound(ctx, state, events), events };
};

describe('fuelOf', () => {
  const { ctx, state } = world();

  it('is vegetationTurns on a field, woodTurns under a wooden structure, 0 on bare ground', () => {
    expect(fuelOf(ctx, state, idx(MID.x, MID.z))).toBe(F.vegetationTurns);
    expect(fuelOf(ctx, state, idx(12, 9))).toBe(F.woodTurns); // under the drawbridge
    expect(fuelOf(ctx, state, idx(20, 9))).toBe(F.woodTurns); // the gate passage
    expect(fuelOf(ctx, state, idx(ROAD_CELL.x, ROAD_CELL.z))).toBe(0);
    expect(fuelOf(ctx, state, idx(2, 2))).toBe(0);
  });

  it('is 0 once burnt, and a lowered drawbridge no longer burns', () => {
    expect(fuelOf(ctx, { ...state, burnt: [idx(MID.x, MID.z)] }, idx(MID.x, MID.z))).toBe(0);
    const lowered = { ...state, structures: state.structures.map((s) => (s.id === IDS.bridge ? { ...s, broken: true } : s)) };
    expect(fuelOf(ctx, lowered, idx(12, 9))).toBe(0);
  });
});

describe('fireArrow', () => {
  it('rejects every invalid shot', () => {
    const { ctx, state } = world();
    const lit = burning(state, idx(MID.x, MID.z));
    const cases: [string, BattleState, Command, CommandRejection][] = [
      ['soldier has no fire arrows', state, shoot(MID.x, MID.z, SOLDIER), 'noFireArrows'],
      ['already burning', lit, shoot(MID.x, MID.z), 'alreadyBurning'],
      ['road does not burn', state, shoot(ROAD_CELL.x, ROAD_CELL.z), 'notFlammable'],
      ['too far', withUnit(state, ARCHER, { position: pt(WEST_ARCHER.x, WEST_ARCHER.z) }), shoot(FAR_FIELD.x, FAR_FIELD.z), 'outOfRange'],
      ['no action left', withUnit(state, ARCHER, { actions: 0 }), shoot(MID.x, MID.z), 'noActionLeft'],
      ['one AP short of attackApCost + arrowExtraAp', withUnit(state, ARCHER, { ap: D.attackApCost + F.arrowExtraAp - 1 }), shoot(MID.x, MID.z), 'insufficientAp'],
      ['out of the map', state, { type: 'fireArrow', unitId: ARCHER, at: { x: -1, z: 3 } }, 'outOfBounds'],
      ['unknown unit', state, shoot(MID.x, MID.z, 'ghost'), 'unknownUnit'],
      ['dead unit', withUnit(state, ARCHER, { alive: false, hp: 0 }), shoot(MID.x, MID.z), 'unitDead'],
      ['not your turn', state, shoot(MID.x, MID.z, IDS.winch), 'notYourTurn'],
      ['fleeing', withUnit(state, ARCHER, { morale: 0 }), shoot(MID.x, MID.z), 'unitFleeing'],
    ];
    for (const [name, s, c, expected] of cases) expect(rejection(ctx, s, c), name).toBe(expected);
  });

  it('is blocked by the gatehouse (noLineOfSight)', () => {
    const { ctx, state } = world();
    const outside = withUnit(state, ARCHER, { position: pt(OUTSIDE_ARCHER.x, OUTSIDE_ARCHER.z) });
    expect(rejection(ctx, outside, shoot(HIDDEN_FIELD.x, HIDDEN_FIELD.z))).toBe('noLineOfSight');
    // From inside the courtyard the same cell is in plain sight.
    expect(rejection(ctx, state, shoot(HIDDEN_FIELD.x, HIDDEN_FIELD.z))).toBeNull();
  });

  it('needs exactly attackApCost + arrowExtraAp: spends 1 action and that many AP', () => {
    const { ctx, state } = world();
    expect(D.attackApCost + F.arrowExtraAp).toBe(2);
    const exact = withUnit(state, ARCHER, { ap: D.attackApCost + F.arrowExtraAp });
    const preview = previewFireArrow(ctx, exact, ARCHER, pt(MID.x, MID.z));
    expect(preview.ok).toBe(true);
    const r = run(ctx, exact, shoot(MID.x, MID.z));
    expect(r.rejections).toEqual([null]);
    const after = unitOf(r.state, ARCHER);
    expect(after.ap).toBe(0);
    expect(after.actions).toBe(unitOf(exact, ARCHER).actions - 1);
  });

  it('consumes the battle RNG and lights the cell when it catches', () => {
    const { ctx, state } = world(rulesWith({}, SURE_FIRE));
    const r = run(ctx, state, shoot(MID.x, MID.z));
    expect(r.state.rng).not.toEqual(state.rng);
    expect(r.state.fires).toEqual([{ cell: idx(MID.x, MID.z), turnsLeft: F.vegetationTurns }]);
    expect(r.events).toContainEqual({ type: 'fireStarted', cells: [idx(MID.x, MID.z)] });
    const shot = r.events.find((e) => e.type === 'fireArrowShot');
    expect(shot).toMatchObject({ unitId: ARCHER, hitChance: 1, caught: true });
  });

  it('a miss leaves no fire but still costs the shot and the RNG draw', () => {
    // hitChanceMax >= hitChanceMin > 0: take the lowest chance and look for a seed that misses.
    const rules = rulesWith({}, { hitChanceMin: 0.05, hitChanceMax: 0.05, accuracy: 0 });
    let missed: ReturnType<typeof run> | null = null;
    for (let i = 0; i < SPREAD_SEEDS && !missed; i++) {
      const w = world(rules);
      const s = createBattle(w.ctx, `miss-${i}`, w.scenario);
      const r = run(w.ctx, s, shoot(MID.x, MID.z));
      if (r.events.some((e) => e.type === 'fireArrowShot' && !e.caught)) missed = r;
    }
    expect(missed).not.toBeNull();
    expect(missed?.state.fires).toEqual([]);
    expect(missed?.events.some((e) => e.type === 'fireStarted')).toBe(false);
    expect(unitOf(missed?.state as BattleState, ARCHER).actions).toBe(0);
  });

  it('can light the timbers of the drawbridge (wood fuel)', () => {
    const { ctx, state } = world(rulesWith({}, SURE_FIRE));
    const shooter = withUnit(state, ARCHER, { position: pt(OUTSIDE_ARCHER.x, OUTSIDE_ARCHER.z) });
    const r = run(ctx, shooter, shoot(12, 9));
    expect(r.rejections).toEqual([null]);
    expect(r.state.fires).toEqual([{ cell: idx(12, 9), turnsLeft: F.woodTurns }]);
  });
});

describe('fireRound timing', () => {
  it('runs when the attackers\' turn comes back, not on the defenders\' turn', () => {
    const { ctx, state } = world(rulesWith(NO_SPREAD));
    const lit = burning(state, idx(MID.x, MID.z));
    const toDefenders = run(ctx, lit, { type: 'endTurn' });
    expect(toDefenders.state.activeFaction).toBe('defender');
    expect(toDefenders.state.fires).toEqual(lit.fires);
    const toAttackers = run(ctx, toDefenders.state, { type: 'endTurn' });
    expect(toAttackers.state.activeFaction).toBe('attacker');
    expect(toAttackers.state.fires).toEqual([{ cell: idx(MID.x, MID.z), turnsLeft: F.vegetationTurns - 1 }]);
  });

  it('does nothing and keeps the state when nothing burns', () => {
    const { ctx, state } = world();
    const events: GameEvent[] = [];
    expect(fireRound(ctx, state, events)).toBe(state);
    expect(events).toEqual([]);
  });
});

describe('fire damage', () => {
  const FIRE_AT = { x: 44, z: 5 };
  const withVictims = (rules: GameRules = rulesWith(NO_SPREAD)) =>
    world(rules, [
      spawn('def-on', 'militia', FIRE_AT.x, FIRE_AT.z),
      spawn('def-near', 'militia', FIRE_AT.x + 1, FIRE_AT.z + 1),
      spawn('def-edge', 'militia', FIRE_AT.x, FIRE_AT.z - 1),
      spawn('def-away', 'militia', FIRE_AT.x + 3, FIRE_AT.z),
      spawn('def-knight', 'sallyKnight', FIRE_AT.x - 1, FIRE_AT.z),
    ]);

  it('burns by burnDamage on the cell, nearDamage within nearRadiusM, and spares the rest, times the armour multiplier', () => {
    const { ctx, state } = withVictims();
    const { state: after, events } = round(ctx, burning(state, idx(FIRE_AT.x, FIRE_AT.z)));
    const light = D.multipliers.fire.light;
    const hp = (id: string) => unitOf(after, id).hp;
    const full = DEFAULT_RULES.units['militia']?.hp as number;
    expect(hp('def-on')).toBe(full - Math.round(F.burnDamage * light));
    expect(hp('def-near')).toBe(full - Math.round(F.nearDamage * light));
    expect(hp('def-edge')).toBe(full - Math.round(F.nearDamage * light));
    expect(hp('def-away')).toBe(full);
    // A knight in heavy armour (fire x1.0) beside the fire.
    const knightFull = DEFAULT_RULES.units['sallyKnight']?.hp as number;
    expect(hp('def-knight')).toBe(knightFull - Math.round(F.nearDamage * D.multipliers.fire.heavy));
    expect(events).toContainEqual({ type: 'unitBurned', unitId: 'def-on', damage: Math.round(F.burnDamage * light), hpAfter: hp('def-on') });
    expect(events.some((e) => e.type === 'unitBurned' && e.unitId === 'def-away')).toBe(false);
  });

  it('shakes the morale of the burned survivors (reason fire) and never below 0', () => {
    const { ctx, state } = withVictims();
    const { state: after, events } = round(ctx, burning(state, idx(FIRE_AT.x, FIRE_AT.z)));
    const before = unitOf(state, 'def-on').morale;
    expect(unitOf(after, 'def-on').morale).toBe(before - F.moraleLoss);
    expect(events).toContainEqual({ type: 'moraleChanged', unitId: 'def-on', morale: before - F.moraleLoss, delta: -F.moraleLoss, reason: 'fire' });
    const low = round(ctx, burning(withUnit(state, 'def-on', { morale: 2 }), idx(FIRE_AT.x, FIRE_AT.z)));
    expect(unitOf(low.state, 'def-on').morale).toBe(0);
  });

  it('kills the weak (unitDied, no morale event for the dead) and ends the battle when a side is gone', () => {
    const { ctx, state } = withVictims();
    const weak = withUnit(state, 'def-on', { hp: 1 });
    const { state: after, events } = round(ctx, burning(weak, idx(FIRE_AT.x, FIRE_AT.z)));
    expect(unitOf(after, 'def-on')).toMatchObject({ alive: false, hp: 0 });
    expect(events).toContainEqual({ type: 'unitDied', unitId: 'def-on', byId: 'def-on' });
    expect(events.some((e) => e.type === 'moraleChanged' && e.unitId === 'def-on')).toBe(false);

    // Every defender dead: the attackers win.
    let lone = burning(state, idx(FIRE_AT.x, FIRE_AT.z));
    lone = { ...lone, units: lone.units.map((u) => (u.faction === 'defender' && u.id !== 'def-on' ? { ...u, alive: false, hp: 0 } : u)) };
    lone = withUnit(lone, 'def-on', { hp: 1 });
    const end = round(ctx, lone);
    expect(end.state.status).not.toBe('ongoing');
    expect(end.events.some((e) => e.type === 'battleEnded')).toBe(true);
  });

  it('an engine of wood burns worst (fire x2.5)', () => {
    const { ctx, state } = world(rulesWith(NO_SPREAD), [spawn('att-cat', 'catapult', FIRE_AT.x, FIRE_AT.z)]);
    const { state: after } = round(ctx, burning(state, idx(FIRE_AT.x, FIRE_AT.z)));
    const full = DEFAULT_RULES.units['catapult']?.hp as number;
    expect(unitOf(after, 'att-cat').hp).toBe(full - Math.round(F.burnDamage * D.multipliers.fire.wood));
  });
});

describe('fuel and burnt cells', () => {
  it('a field burns vegetationTurns rounds, then goes out into burnt and never catches again', () => {
    const { ctx, state } = world(rulesWith(NO_SPREAD));
    const cell = idx(MID.x, MID.z);
    let s = burning(state, cell);
    const outs: GameEvent[] = [];
    for (let i = 1; i < F.vegetationTurns; i++) {
      const r = round(ctx, s);
      s = r.state;
      expect(s.fires).toEqual([{ cell, turnsLeft: F.vegetationTurns - i }]);
      expect(s.burnt).toEqual([]);
    }
    const last = round(ctx, s);
    outs.push(...last.events);
    expect(last.state.fires).toEqual([]);
    expect(last.state.burnt).toEqual([cell]);
    expect(outs).toContainEqual({ type: 'fireOut', cells: [cell], byId: null });
    expect(fuelOf(ctx, last.state, cell)).toBe(0);
    expect(rejection(ctx, last.state, shoot(MID.x, MID.z))).toBe('notFlammable');
  });

  it('wood burns woodTurns rounds', () => {
    const { ctx, state } = world(rulesWith(NO_SPREAD));
    const cell = idx(12, 9);
    let s: BattleState = { ...state, fires: [{ cell, turnsLeft: F.woodTurns }] };
    for (let i = 0; i < F.woodTurns - 1; i++) s = round(ctx, s).state;
    expect(s.fires).toEqual([{ cell, turnsLeft: 1 }]);
    s = round(ctx, s).state;
    expect(s.fires).toEqual([]);
    expect(s.burnt).toContain(cell);
  });

  it('a burnt neighbour is never lit again by a spreading fire', () => {
    const certain = rulesWith({ spreadChance: 1, spreadMax: 1, windSpread: 0 });
    const { ctx, state } = world(certain);
    const centre = idx(MID.x, MID.z);
    const east = idx(MID.x + 1, MID.z);
    const s = { ...burning(state, centre), burnt: [east] };
    const after = round(ctx, s).state;
    expect(after.fires.some((f) => f.cell === east)).toBe(false);
    expect(after.fires.some((f) => f.cell === idx(MID.x - 1, MID.z))).toBe(true);
    expect(after.burnt).toContain(east);
  });
});

describe('spread', () => {
  const litCount = (cellOf: (x: number, z: number) => number, dir: { x: number; z: number }, strength: number): number => {
    const w = world();
    let count = 0;
    const target = cellOf(MID.x + dir.x, MID.z + dir.z);
    for (let i = 0; i < SPREAD_SEEDS; i++) {
      const s = createBattle(w.ctx, `spread-${i}`, w.scenario);
      const windy = { ...burning(s, cellOf(MID.x, MID.z)), wind: { x: 1, z: 0, strength } };
      if (round(w.ctx, windy).state.fires.some((f) => f.cell === target)) count++;
    }
    return count;
  };

  it('is far likelier downwind than upwind (same seeds)', () => {
    const down = litCount(idx, { x: 1, z: 0 }, 1);
    const up = litCount(idx, { x: -1, z: 0 }, 1);
    expect(down).toBeGreaterThan(up + SPREAD_SEEDS / 4);
    expect(up).toBe(0);
  });

  it('without wind both sides spread alike, near spreadChance', () => {
    const e = litCount(idx, { x: 1, z: 0 }, 0) / SPREAD_SEEDS;
    const w = litCount(idx, { x: -1, z: 0 }, 0) / SPREAD_SEEDS;
    expect(Math.abs(e - F.spreadChance)).toBeLessThan(0.1);
    expect(Math.abs(w - F.spreadChance)).toBeLessThan(0.1);
  });

  it('only reaches flammable cells (not the road) and announces the new fires', () => {
    const certain = rulesWith({ spreadChance: 1, spreadMax: 1, windSpread: 0 });
    const { ctx, state } = world(certain);
    // A fire beside the road cell: the road stays clear.
    const beside = idx(ROAD_CELL.x + 1, ROAD_CELL.z);
    const r = round(ctx, { ...state, fires: [{ cell: beside, turnsLeft: F.vegetationTurns }] });
    expect(r.state.fires.some((f) => f.cell === idx(ROAD_CELL.x, ROAD_CELL.z))).toBe(false);
    // The Field starts at x = 40: from the cell beside the road (x = 37, Plain) nothing flammable is near.
    expect(r.events.some((e) => e.type === 'fireStarted')).toBe(false);
    const edge = round(ctx, burning(state, idx(FIELD.x0, FIELD.z0)));
    const started = edge.events.find((e) => e.type === 'fireStarted');
    expect(started).toBeDefined();
    if (started?.type === 'fireStarted') expect([...started.cells]).toEqual([...started.cells].sort((a, b) => a - b));
    // The map edge does not wrap: row 0 cells have no row -1 neighbour.
    const top = round(ctx, burning(state, idx(FIELD.x0, 0)));
    expect(top.state.fires.every((f) => f.cell >= 0)).toBe(true);
  });
});

describe('extinguish', () => {
  const lit = (): { ctx: BattleContext; state: BattleState } => {
    const w = world(DEFAULT_RULES, [spawn('att-douse', 'soldier', MID.x - 1, MID.z)]);
    const cells = [idx(MID.x, MID.z), idx(MID.x + 1, MID.z), idx(MID.x, MID.z + 1), idx(MID.x + 4, MID.z)];
    return { ctx: w.ctx, state: burning(w.state, ...cells) };
  };

  it('puts out the targeted fire and its burning neighbours, but not a distant one', () => {
    const { ctx, state } = lit();
    const r = run(ctx, state, douse(MID.x, MID.z, 'att-douse'));
    expect(r.rejections).toEqual([null]);
    expect(r.state.fires).toEqual([{ cell: idx(MID.x + 4, MID.z), turnsLeft: F.vegetationTurns }]);
    expect(r.events).toContainEqual({ type: 'fireOut', cells: [idx(MID.x, MID.z), idx(MID.x + 1, MID.z), idx(MID.x, MID.z + 1)].sort((a, b) => a - b), byId: 'att-douse' });
    const worker = unitOf(r.state, 'att-douse');
    expect(worker.actions).toBe(0);
    expect(worker.ap).toBe(unitOf(state, 'att-douse').ap - D.attackApCost);
    // Extinguished cells are not burnt out: they could catch again.
    expect(r.state.burnt).toEqual([]);
    expect(fuelOf(ctx, r.state, idx(MID.x, MID.z))).toBe(F.vegetationTurns);
  });

  it('previewExtinguish lists the cells sorted', () => {
    const { ctx, state } = lit();
    const p = previewExtinguish(ctx, state, 'att-douse', pt(MID.x, MID.z));
    expect(p).toEqual({ ok: true, cells: [idx(MID.x, MID.z), idx(MID.x + 1, MID.z), idx(MID.x, MID.z + 1)].sort((a, b) => a - b) });
  });

  it('rejects every invalid attempt', () => {
    const { ctx, state } = lit();
    const cases: [string, BattleState, Command, CommandRejection][] = [
      ['nothing burns there', state, douse(MID.x - 3, MID.z, 'att-douse'), 'notBurning'],
      ['too far from the fire', state, douse(MID.x + 4, MID.z, 'att-douse'), 'outOfRange'],
      ['no action', withUnit(state, 'att-douse', { actions: 0 }), douse(MID.x, MID.z, 'att-douse'), 'noActionLeft'],
      ['no AP', withUnit(state, 'att-douse', { ap: D.attackApCost - 1 }), douse(MID.x, MID.z, 'att-douse'), 'insufficientAp'],
      ['unknown unit', state, douse(MID.x, MID.z, 'ghost'), 'unknownUnit'],
      ['dead unit', withUnit(state, 'att-douse', { alive: false, hp: 0 }), douse(MID.x, MID.z, 'att-douse'), 'unitDead'],
      ['not your turn', state, douse(MID.x, MID.z, IDS.winch), 'notYourTurn'],
      ['fleeing', withUnit(state, 'att-douse', { morale: 0 }), douse(MID.x, MID.z, 'att-douse'), 'unitFleeing'],
    ];
    for (const [name, s, c, expected] of cases) expect(rejection(ctx, s, c), name).toBe(expected);
  });
});

describe('wooden structures', () => {
  it('the drawbridge falls (structureBroken, byId null) when the fire on its timbers goes out', () => {
    const { ctx, state } = world(rulesWith(NO_SPREAD));
    const cell = idx(12, 9);
    let s: BattleState = { ...state, fires: [{ cell, turnsLeft: 1 }] };
    expect(s.structures.find((x) => x.id === IDS.bridge)?.broken).toBe(false);
    const r = round(ctx, s);
    s = r.state;
    expect(r.events).toContainEqual({ type: 'structureBroken', structureId: IDS.bridge, kind: 'drawbridge', byId: null, fallen: [] });
    expect(s.structures.find((x) => x.id === IDS.bridge)?.broken).toBe(true);
  });

  it('the bridge stays up while its fire still has fuel', () => {
    const { ctx, state } = world(rulesWith(NO_SPREAD));
    const r = round(ctx, { ...state, fires: [{ cell: idx(12, 9), turnsLeft: 2 }] });
    expect(r.state.structures.find((x) => x.id === IDS.bridge)?.broken).toBe(false);
    expect(r.events.some((e) => e.type === 'structureBroken')).toBe(false);
  });

  it('the gate loses structureDamage per round of fire and breaks at 0', () => {
    const { ctx, state } = world(rulesWith(NO_SPREAD));
    const gateCell = idx(20, 9);
    const hp = (s: BattleState) => s.structures.find((x) => x.id === IDS.gate)?.hp as number;
    const r = round(ctx, { ...state, fires: [{ cell: gateCell, turnsLeft: F.woodTurns }] });
    expect(hp(r.state)).toBe(hp(state) - F.structureDamage);
    expect(r.events).toContainEqual({ type: 'structureBurned', structureId: IDS.gate, damage: F.structureDamage, hpAfter: hp(state) - F.structureDamage });
    // Two fires on the gate passage hurt it twice.
    const two = round(ctx, { ...state, fires: [{ cell: gateCell, turnsLeft: 2 }, { cell: idx(20, 10), turnsLeft: 2 }] });
    expect(hp(two.state)).toBe(hp(state) - 2 * F.structureDamage);
    // Almost gone: it breaks.
    const weak = { ...state, structures: state.structures.map((x) => (x.id === IDS.gate ? { ...x, hp: 1 } : x)) };
    const gone = round(ctx, { ...weak, fires: [{ cell: gateCell, turnsLeft: 2 }] });
    expect(hp(gone.state)).toBe(0);
    expect(gone.state.structures.find((x) => x.id === IDS.gate)?.broken).toBe(true);
    expect(gone.events).toContainEqual({ type: 'structureBroken', structureId: IDS.gate, kind: 'gate', byId: null, fallen: [] });
    // A broken gate takes no more damage.
    const again = round(ctx, { ...gone.state, fires: [{ cell: gateCell, turnsLeft: 2 }] });
    expect(again.events.some((e) => e.type === 'structureBurned')).toBe(false);
  });
});

describe('determinism', () => {
  it('replays to the same hash, also after a JSON round trip of the commands', () => {
    const rules = rulesWith({}, SURE_FIRE);
    const w = world(rules, [spawn('att-douse', 'soldier', MID.x - 1, MID.z)]);
    const commands: Command[] = [shoot(MID.x, MID.z), shoot(MID.x + 1, MID.z), ...NEW_ROUND, ...NEW_ROUND, douse(MID.x, MID.z, 'att-douse'), ...NEW_ROUND];
    const a = replay(w.ctx, SEED, w.scenario, commands);
    const b = replay(w.ctx, SEED, w.scenario, JSON.parse(JSON.stringify(commands)) as Command[]);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    expect(a.events).toEqual(b.events);
    expect(a.state.burnt.length + a.state.fires.length).toBeGreaterThan(0);
  });
});
