/**
 * Siege engines against castle structures (src/core/battle/siege.ts, structures.ts, apply.ts):
 * the rejection of every illegal strike, the shared odds of preview and roll, the collapse of a
 * wall segment, and the drawbridge that drops with its winch operator. Built on the synthetic
 * castle of siege-fixture.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle, findUnit, hashBattleState, replay, type BattleState, type Command, type CommandRejection, type GameEvent } from '@core/index.ts';
import { distanceToCells, distanceToStructure, lowerDrawbridges, previewStructureAttack, resolveStructureAttack, shieldOf, structuresInReach } from '@core/battle/siege.ts';
import { initialStructures, isBroken, navSignature, structureDef } from '@core/battle/structures.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { buildFixture, defaultUnits, freshBattle, IDS, spawn, withBroken, withUnit } from './siege-fixture.ts';
import { rulesWithDamageOverrides } from './helpers.ts';

const D = DEFAULT_RULES.damage;
const S = DEFAULT_RULES.structures;
/** A rules set where every roll hits and never crits: outcomes then depend on damage only. */
const SURE_HIT = { hitChanceMin: 1, hitChanceMax: 1, critChance: 0 };
/** Metres added to the catapult's range to put it out of reach. */
const BEYOND_RANGE_M = 2;
/** A point far west of the gate, out of ram reach. */
const FAR_FROM_GATE = { x: 5.5, z: 9.5 };
/** Tolerance for floating-point probability comparisons. */
const PRECISION_DIGITS = 12;
/** Cells between a point and the wall segment (x = 20) in the distance checks. */
const WALL_GAP_M = 3;

function reasonOf(r: ReturnType<typeof previewStructureAttack>): CommandRejection | 'ok' {
  return r.ok ? 'ok' : r.reason;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

describe('previewStructureAttack: rejections', () => {
  const { ctx, state } = freshBattle();
  const open = withBroken(state, IDS.bridge);

  it('unknown unit, dead unit, unarmed unit', () => {
    expect(reasonOf(previewStructureAttack(ctx, state, 'nobody', IDS.wallA))).toBe('unknownUnit');
    expect(reasonOf(previewStructureAttack(ctx, withUnit(state, IDS.catapult, { alive: false }), IDS.catapult, IDS.wallA))).toBe('unitDead');
    const f = buildFixture(DEFAULT_RULES, [...defaultUnits(), spawn('att-tower', 'siegeTower', 17, 12)]);
    const s = createBattle(f.ctx, 'x', f.scenario);
    expect(reasonOf(previewStructureAttack(f.ctx, s, 'att-tower', IDS.wallA))).toBe('noAttack');
  });

  it('unknownStructure', () => {
    expect(reasonOf(previewStructureAttack(ctx, state, IDS.catapult, 'wall:nope'))).toBe('unknownStructure');
  });

  it('structureDown', () => {
    expect(reasonOf(previewStructureAttack(ctx, withBroken(state, IDS.wallA), IDS.catapult, IDS.wallA))).toBe('structureDown');
  });

  it('structureInvulnerable: the drawbridge cannot be attacked', () => {
    expect(reasonOf(previewStructureAttack(ctx, state, IDS.catapult, IDS.bridge))).toBe('structureInvulnerable');
  });

  it('noSiegeWeapon: a soldier against a curtain wall', () => {
    expect(reasonOf(previewStructureAttack(ctx, state, IDS.soldier, IDS.wallA))).toBe('noSiegeWeapon');
  });

  it('gatesOnly: a ram against a curtain wall', () => {
    expect(reasonOf(previewStructureAttack(ctx, state, IDS.ram, IDS.wallA))).toBe('gatesOnly');
  });

  it('structureShielded: gate behind the raised drawbridge, portcullis behind the intact gate', () => {
    expect(reasonOf(previewStructureAttack(ctx, state, IDS.ram, IDS.gate))).toBe('structureShielded');
    expect(reasonOf(previewStructureAttack(ctx, open, IDS.ram, IDS.portcullis))).toBe('structureShielded');
    expect(shieldOf(ctx, state.structures, structureDef(ctx, IDS.wallA)!)).toBeNull();
    expect(shieldOf(ctx, state.structures, structureDef(ctx, IDS.gate)!)?.id).toBe(IDS.bridge);
    expect(shieldOf(ctx, open.structures, structureDef(ctx, IDS.gate)!)).toBeNull();
    expect(shieldOf(ctx, open.structures, structureDef(ctx, IDS.portcullis)!)?.id).toBe(IDS.gate);
  });

  it('outOfRange: a ram far from the gate; a catapult beyond its reach', () => {
    const far = withUnit(open, IDS.ram, { position: FAR_FROM_GATE });
    expect(reasonOf(previewStructureAttack(ctx, far, IDS.ram, IDS.gate))).toBe('outOfRange');
    const rangeM = DEFAULT_RULES.units.catapult!.attack!.rangeM;
    const beyond = withUnit(state, IDS.catapult, { position: { x: 20.5 + rangeM + BEYOND_RANGE_M, z: 10.5 } });
    expect(reasonOf(previewStructureAttack(ctx, beyond, IDS.catapult, IDS.wallA))).toBe('outOfRange');
  });

  it('noActionLeft and insufficientAp', () => {
    expect(reasonOf(previewStructureAttack(ctx, withUnit(state, IDS.catapult, { actions: 0 }), IDS.catapult, IDS.wallA))).toBe('noActionLeft');
    expect(reasonOf(previewStructureAttack(ctx, withUnit(state, IDS.catapult, { ap: 0 }), IDS.catapult, IDS.wallA))).toBe('insufficientAp');
  });

  it('notYourTurn', () => {
    expect(reasonOf(previewStructureAttack(ctx, { ...state, activeFaction: 'defender' }, IDS.catapult, IDS.wallA))).toBe('notYourTurn');
  });
});

describe('previewStructureAttack: nominal odds', () => {
  const { ctx, state } = freshBattle();
  const open = withBroken(state, IDS.bridge);

  it('catapult on a wall: accuracy + hitBonus, siege vs stone', () => {
    const r = previewStructureAttack(ctx, state, IDS.catapult, IDS.wallA);
    if (!r.ok) throw new Error(r.reason);
    const attack = DEFAULT_RULES.units.catapult!.attack!;
    expect(r.preview.blow.hitChance).toBeCloseTo(clamp(attack.accuracy + S.hitBonus, D.hitChanceMin, D.hitChanceMax), PRECISION_DIGITS);
    const base = attack.power * (1 - D.armorReduction.stone) * D.multipliers.siege.stone;
    expect(r.preview.blow.damage.min).toBe(Math.round(base));
    expect(r.preview.blow.damage.max).toBe(Math.round(base * D.critMultiplier));
    expect(r.preview.melee).toBe(false);
    expect(r.preview.apCost).toBe(D.attackApCost);
  });

  it('ram on the gate: the hit chance is clamped to hitChanceMax, damage is siege vs wood', () => {
    const r = previewStructureAttack(ctx, open, IDS.ram, IDS.gate);
    if (!r.ok) throw new Error(r.reason);
    const attack = DEFAULT_RULES.units.ram!.attack!;
    expect(attack.accuracy + S.hitBonus).toBeGreaterThan(D.hitChanceMax);
    expect(r.preview.blow.hitChance).toBe(D.hitChanceMax);
    expect(r.preview.blow.damage.min).toBe(Math.round(attack.power * D.multipliers.siege.wood));
    expect(r.preview.melee).toBe(true);
    expect(r.preview.rangeM).toBe(D.meleeReachM);
    expect(r.preview.distanceM).toBeLessThanOrEqual(D.meleeReachM);
  });

  it('ram on the portcullis once the gate is down: heavy armour reduces damage', () => {
    const r = previewStructureAttack(ctx, withBroken(state, IDS.bridge, IDS.gate), IDS.ram, IDS.portcullis);
    if (!r.ok) throw new Error(r.reason);
    const attack = DEFAULT_RULES.units.ram!.attack!;
    expect(r.preview.blow.damage.min).toBe(Math.round(attack.power * (1 - D.armorReduction.heavy) * D.multipliers.siege.heavy));
  });

  it('structuresInReach lists exactly the previews that succeed', () => {
    expect(structuresInReach(ctx, open, IDS.ram).map((p) => p.structureId)).toEqual([IDS.gate]);
    expect(structuresInReach(ctx, state, IDS.catapult).map((p) => p.structureId)).toEqual([IDS.wallA, IDS.wallB]);
    expect(structuresInReach(ctx, state, IDS.soldier)).toEqual([]);
  });

  it('distance helpers: zero inside a structure, metric outside', () => {
    const wall = structureDef(ctx, IDS.wallA)!;
    expect(distanceToCells(ctx, wall.cells, { x: 20.5, z: 3.5 })).toBe(0);
    expect(distanceToCells(ctx, wall.cells, { x: 20 - WALL_GAP_M, z: 3.5 })).toBe(WALL_GAP_M);
    expect(distanceToStructure(ctx, wall, { x: 20 - WALL_GAP_M, z: 3.5 })).toBe(WALL_GAP_M);
    // A structure without cells falls back on its centre.
    const empty = { ...wall, cells: [] };
    expect(distanceToStructure(ctx, empty, { x: 20.5, z: 6 })).toBe(2);
  });
});

describe('structure attack: preview and roll agree', () => {
  it('the structureDamaged event carries the preview chance; PA -1, action -1; the RNG advances', () => {
    const { ctx, state } = freshBattle();
    const preview = previewStructureAttack(ctx, state, IDS.catapult, IDS.wallA);
    if (!preview.ok) throw new Error(preview.reason);
    const res = applyCommand(ctx, state, { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA });
    expect(res.rejection).toBeNull();
    const ev = res.events.find((e) => e.type === 'structureDamaged');
    if (ev?.type !== 'structureDamaged') throw new Error('no structureDamaged event');
    expect(ev.hitChance).toBe(preview.preview.blow.hitChance);
    const before = findUnit(state, IDS.catapult)!;
    const after = findUnit(res.state, IDS.catapult)!;
    expect(after.ap).toBe(before.ap - D.attackApCost);
    expect(after.actions).toBe(before.actions - 1);
    expect(res.state.rng).not.toEqual(state.rng);
    const hp = res.state.structures.find((s) => s.id === IDS.wallA)!.hp;
    expect(hp).toBe(S.wallHp - ev.damage);
    expect(ev.hpAfter).toBe(hp);
    if (!ev.hit) expect(ev.damage).toBe(0);
  });

  it('is deterministic: same state and command, same outcome', () => {
    const { ctx, state } = freshBattle();
    const cmd: Command = { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallB };
    const a = applyCommand(ctx, state, cmd);
    const b = applyCommand(ctx, state, cmd);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    expect(a.events).toEqual(b.events);
  });

  it('resolveStructureAttack leaves its input untouched', () => {
    const { ctx, state } = freshBattle();
    const frozen = JSON.stringify(state);
    const p = previewStructureAttack(ctx, state, IDS.catapult, IDS.wallA);
    if (!p.ok) throw new Error(p.reason);
    const out = resolveStructureAttack(ctx, state, p.preview);
    expect(JSON.stringify(state)).toBe(frozen);
    expect(out.state.rng).not.toEqual(state.rng);
    expect(out.events[0]?.type).toBe('structureDamaged');
  });

  it('with sure hits a wall falls after ceil(wallHp / damage) blows, then is "structureDown"', () => {
    const f = buildFixture(rulesWithDamageOverrides(SURE_HIT));
    let state = createBattle(f.ctx, 's', f.scenario);
    const perHit = Math.round(DEFAULT_RULES.units.catapult!.attack!.power * D.multipliers.siege.stone);
    const blows = Math.ceil(S.wallHp / perHit);
    for (let i = 0; i < blows; i++) {
      state = withUnit(state, IDS.catapult, { ap: 2, actions: 1 });
      const r = applyCommand(f.ctx, state, { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallB });
      expect(r.rejection).toBeNull();
      state = r.state;
    }
    expect(isBroken(state.structures, IDS.wallB)).toBe(true);
    expect(state.structures.find((s) => s.id === IDS.wallB)!.hp).toBe(0);
    const again = applyCommand(f.ctx, withUnit(state, IDS.catapult, { ap: 2, actions: 1 }), { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallB });
    expect(again.rejection).toBe('structureDown');
  });

  it('a fleeing siege engine is refused', () => {
    const { ctx, state } = freshBattle();
    const r = applyCommand(ctx, withUnit(state, IDS.catapult, { morale: 0 }), { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA });
    expect(r.rejection).toBe('unitFleeing');
  });
});

describe('wall collapse', () => {
  const rules = rulesWithDamageOverrides(SURE_HIT);

  function collapseWall(extra: (s: BattleState) => BattleState = (s) => s) {
    const f = buildFixture(rules);
    let state = createBattle(f.ctx, 'collapse', f.scenario);
    state = { ...state, structures: state.structures.map((s) => (s.id === IDS.wallA ? { ...s, hp: 1 } : s)) };
    state = extra(state);
    const res = applyCommand(f.ctx, state, { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA });
    return { f, before: state, res };
  }

  it('units on the segment take fallDamage and lose their guard; others keep theirs', () => {
    const guarded = { x: 1, z: 0 };
    const { before, res } = collapseWall((s) => withUnit(withUnit(s, IDS.guardA, { overwatch: guarded }), IDS.near, { overwatch: guarded }));
    expect(res.rejection).toBeNull();
    const broken = res.events.find((e) => e.type === 'structureBroken');
    expect(broken).toMatchObject({ structureId: IDS.wallA, kind: 'wall', byId: IDS.catapult });
    const guard = findUnit(res.state, IDS.guardA)!;
    expect(guard.hp).toBe(findUnit(before, IDS.guardA)!.hp - S.fallDamage);
    expect(guard.overwatch).toBeNull();
    expect(broken?.type === 'structureBroken' && broken.fallen.map((f) => f.unitId).sort()).toEqual([IDS.guardA, IDS.guardB]);
    expect(findUnit(res.state, IDS.near)!.overwatch).not.toBeNull();
    expect(findUnit(res.state, IDS.near)!.hp).toBe(findUnit(before, IDS.near)!.hp);
  });

  it('a unit whose hp falls to zero dies (unitDied)', () => {
    const { res } = collapseWall((s) => withUnit(s, IDS.guardB, { hp: S.fallDamage }));
    expect(findUnit(res.state, IDS.guardB)!.alive).toBe(false);
    expect(res.events).toContainEqual({ type: 'unitDied', unitId: IDS.guardB, byId: IDS.catapult });
    expect(findUnit(res.state, IDS.guardA)!.alive).toBe(true);
  });

  it('defenders within the radius lose collapseMoraleLoss (wallCollapsed); those beyond do not', () => {
    const { before, res } = collapseWall();
    const touched = new Set(res.events.flatMap((e) => (e.type === 'moraleChanged' && e.reason === 'wallCollapsed' ? [e.unitId] : [])));
    expect(touched.has(IDS.near)).toBe(true);
    expect(touched.has(IDS.far)).toBe(false);
    expect(touched.has(IDS.catapult)).toBe(false);
    expect(findUnit(res.state, IDS.near)!.morale).toBe(findUnit(before, IDS.near)!.morale - S.collapseMoraleLoss);
    expect(findUnit(res.state, IDS.far)!.morale).toBe(findUnit(before, IDS.far)!.morale);
  });

  it('battleEnded when the fall kills the last defender', () => {
    const f = buildFixture(rules, [spawn(IDS.catapult, 'catapult', 16, 15), spawn(IDS.guardA, 'wallGuard', 20, 3)]);
    let state = createBattle(f.ctx, 'last', f.scenario);
    state = withUnit({ ...state, structures: state.structures.map((s) => (s.id === IDS.wallA ? { ...s, hp: 1 } : s)) }, IDS.guardA, { hp: 1 });
    const res = applyCommand(f.ctx, state, { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA });
    expect(res.state.status).toBe('attackerWon');
    expect(res.events).toContainEqual({ type: 'battleEnded', status: 'attackerWon' });
    expect(applyCommand(f.ctx, res.state, { type: 'endTurn' }).rejection).toBe('battleOver');
  });

  it('a blow that does not break the wall leaves its units untouched', () => {
    const f = buildFixture(rules);
    const state = createBattle(f.ctx, 'dent', f.scenario);
    const res = applyCommand(f.ctx, state, { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA });
    expect(res.events.some((e) => e.type === 'structureBroken')).toBe(false);
    expect(findUnit(res.state, IDS.guardA)!.hp).toBe(findUnit(state, IDS.guardA)!.hp);
  });

  it('a broken gate shakes nobody (only walls collapse on units)', () => {
    const f = buildFixture(rules);
    let state = withBroken(createBattle(f.ctx, 'gate', f.scenario), IDS.bridge);
    state = { ...state, structures: state.structures.map((s) => (s.id === IDS.gate ? { ...s, hp: 1 } : s)) };
    const res = applyCommand(f.ctx, state, { type: 'attackStructure', unitId: IDS.ram, structureId: IDS.gate });
    expect(res.events.find((e) => e.type === 'structureBroken')).toMatchObject({ kind: 'gate', fallen: [] });
    expect(res.events.some((e) => e.type === 'moraleChanged')).toBe(false);
  });
});

describe('lowerDrawbridges', () => {
  it('an operator killed by a normal attack drops the bridge in the same command', () => {
    const f = buildFixture(rulesWithDamageOverrides(SURE_HIT), [...defaultUnits(), spawn('att-arch', 'archer', 26, 9)]);
    let state = createBattle(f.ctx, 'winch', f.scenario);
    state = withUnit(state, IDS.winch, { hp: 1 });
    const res = applyCommand(f.ctx, state, { type: 'attack', unitId: 'att-arch', targetId: IDS.winch });
    expect(res.rejection).toBeNull();
    expect(findUnit(res.state, IDS.winch)!.alive).toBe(false);
    expect(isBroken(res.state.structures, IDS.bridge)).toBe(true);
    expect(res.events).toContainEqual({ type: 'structureBroken', structureId: IDS.bridge, kind: 'drawbridge', byId: null, fallen: [] });
    expect(f.ctx.navKey).toBe(navSignature(res.state.structures));
  });

  it('lowers once: a bridge already down emits nothing more', () => {
    const { ctx, state } = freshBattle();
    const dead = withUnit(state, IDS.winch, { alive: false, hp: 0 });
    const events: GameEvent[] = [];
    const lowered = lowerDrawbridges(ctx, dead, events);
    expect(events).toHaveLength(1);
    const again: GameEvent[] = [];
    expect(lowerDrawbridges(ctx, lowered, again)).toBe(lowered);
    expect(again).toHaveLength(0);
  });

  it('a living operator keeps the bridge up (state returned as is)', () => {
    const { ctx, state } = freshBattle();
    const events: GameEvent[] = [];
    expect(lowerDrawbridges(ctx, state, events)).toBe(state);
    expect(events).toEqual([]);
  });

  it('an operator absent from the scenario drops nothing', () => {
    const f = buildFixture(DEFAULT_RULES, defaultUnits().filter((u) => u.id !== IDS.winch));
    const state = createBattle(f.ctx, 'no-winch', f.scenario);
    const events: GameEvent[] = [];
    expect(lowerDrawbridges(f.ctx, state, events)).toBe(state);
    const res = applyCommand(f.ctx, state, { type: 'endTurn' });
    expect(isBroken(res.state.structures, IDS.bridge)).toBe(false);
  });
});

describe('replay with structures', () => {
  const commands: Command[] = [
    { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA },
    { type: 'endTurn' },
    { type: 'endTurn' },
    { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA },
    { type: 'attackStructure', unitId: IDS.ram, structureId: IDS.gate },
    { type: 'endTurn' },
    { type: 'endTurn' },
    { type: 'attackStructure', unitId: IDS.catapult, structureId: IDS.wallA },
  ];
  const SEED = 'r-seed';

  it('gives the same hash every time and after a JSON round trip of the commands', () => {
    const run = (cmds: readonly Command[]) => {
      const f = buildFixture(rulesWithDamageOverrides(SURE_HIT));
      return hashBattleState(replay(f.ctx, SEED, f.scenario, cmds).state);
    };
    const h = run(commands);
    expect(run(commands)).toBe(h);
    expect(run(JSON.parse(JSON.stringify(commands)) as Command[])).toBe(h);
    expect(run(commands.slice(0, 3))).not.toBe(h);
  });

  it('breaks the wall and a replay on a warm context (grid cache) agrees', () => {
    const f = buildFixture(rulesWithDamageOverrides(SURE_HIT));
    const a = replay(f.ctx, SEED, f.scenario, commands);
    expect(isBroken(a.state.structures, IDS.wallA)).toBe(true);
    const b = replay(f.ctx, SEED, f.scenario, commands);
    expect(hashBattleState(b.state)).toBe(hashBattleState(a.state));
    expect(initialStructures(f.defs).map((s) => s.hp)).toEqual(f.defs.map((d) => d.maxHp));
  });
});
