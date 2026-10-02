/**
 * The siege on a real generated map (seed 'siege-1', castle 1): planStructures finds the drawbridge,
 * the gate, the portcullis and the curtain segments; the sealed castle has no way in; the way opens
 * with bridge + gate + portcullis down; the ram of the siege park reaches the gate front once the
 * bridge is down. The 512 m map takes seconds to generate: it is built once, in beforeAll.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createBattle, createBattleContext, findPath, hashBattleState, isPassable, replay, type BattleContext, type BattleState, type Command, type Scenario, type Vec2 } from '@core/index.ts';
import { planStructures, syncNav, type StructureDef } from '@core/battle/structures.ts';
import { previewStructureAttack } from '@core/battle/siege.ts';
import { generateBattleMap } from '@core/worldgen/battle.ts';
import type { WorldLayout } from '@core/worldgen/types.ts';
import { DEFAULT_RULES } from '@data/index.ts';

const SEED = 'siege-1';
const CASTLE_INDEX = 1;
/** Map generation is ~3.5 s; the file budget is raised accordingly. */
const HEAVY_TIMEOUT_MS = 60_000;
const OUTSIDE_M = 28;
const INSIDE_M = 8;
const RAM_FRONT_M = 2.5;
const MIN_WALL_SEGMENTS = 4;
const RAM_ID = 'att-siege-0';
const CATAPULT_ID = 'att-siege-1';
const WINCH_ID = 'def-tower-0';

let layout: WorldLayout;
let ctx: BattleContext;
let defs: readonly StructureDef[];
let scenario: Scenario;
let state: BattleState;
let outward: Vec2;
let outside: Vec2;
let inside: Vec2;

const idOf = (kind: StructureDef['kind']) => defs.filter((d) => d.kind === kind);
const cellAt = (p: Vec2) => Math.floor(p.z) * ctx.nav.width + Math.floor(p.x);
const broken = (...ids: string[]): BattleState => ({ ...state, structures: state.structures.map((s) => (ids.includes(s.id) ? { ...s, hp: 0, broken: true } : s)) });

beforeAll(() => {
  layout = generateBattleMap({ seed: SEED, castleIndex: CASTLE_INDEX }).layout;
  defs = planStructures(layout, DEFAULT_RULES.structures);
  ctx = createBattleContext(layout.terrain, DEFAULT_RULES, layout.deck, defs);
  scenario = {
    units: layout.units.flatMap((m) => {
      const type = DEFAULT_RULES.units[m.typeKey];
      if (!type || !isPassable(ctx.nav, type.movement, Math.floor(m.position.x), Math.floor(m.position.z))) return [];
      const a = m.facingTurns * 2 * Math.PI;
      return [{ id: m.id, typeKey: m.typeKey, position: m.position, facing: { x: Math.sin(a), z: Math.cos(a) } }];
    }),
    firstFaction: 'attacker',
  };
  state = createBattle(ctx, SEED, scenario);
  const gate = layout.gates[0]!;
  const a = gate.rotationTurns * 2 * Math.PI;
  outward = { x: Math.sin(a), z: Math.cos(a) };
  outside = { x: gate.center.x + outward.x * OUTSIDE_M, z: gate.center.z + outward.z * OUTSIDE_M };
  inside = { x: gate.center.x - outward.x * INSIDE_M, z: gate.center.z - outward.z * INSIDE_M };
}, HEAVY_TIMEOUT_MS);

describe('planStructures on the real map', () => {
  it('one drawbridge run by def-tower-0, one gate, one portcullis, at least four curtain segments', () => {
    expect(idOf('drawbridge')).toHaveLength(1);
    expect(idOf('drawbridge')[0]).toMatchObject({ operatorId: WINCH_ID, maxHp: 0 });
    expect(idOf('gate')).toHaveLength(1);
    expect(idOf('portcullis')).toHaveLength(1);
    expect(idOf('wall').length).toBeGreaterThanOrEqual(MIN_WALL_SEGMENTS);
    expect(idOf('gate')[0]!.maxHp).toBe(DEFAULT_RULES.structures.gateHp);
    expect(idOf('portcullis')[0]!.maxHp).toBe(DEFAULT_RULES.structures.portcullisHp);
    for (const w of idOf('wall')) expect(w.cells.length).toBeGreaterThan(0);
  });

  it('is sorted by id, and the cells of the segments are disjoint', () => {
    const ids = defs.map((d) => d.id);
    expect(ids).toEqual([...ids].sort());
    const seen = new Set<number>();
    for (const w of idOf('wall')) for (const c of w.cells) { expect(seen.has(c)).toBe(false); seen.add(c); }
  });

  it('the siege park holds a ram and a catapult; the winch operator stands in the scenario', () => {
    const ids = scenario.units.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([RAM_ID, CATAPULT_ID, WINCH_ID]));
    expect(layout.gates[0]!.winchOperatorId).toBe(WINCH_ID);
  });
});

describe('the castle on the real map: navigation', { timeout: HEAVY_TIMEOUT_MS }, () => {
  const crossing = () => findPath(ctx.paths, { profile: 'foot', start: cellAt(outside), goal: cellAt(inside) });

  it('intact: no way for foot units from outside the gate to the courtyard', () => {
    syncNav(ctx, state.structures);
    expect(isPassable(ctx.nav, 'foot', Math.floor(outside.x), Math.floor(outside.z))).toBe(true);
    expect(isPassable(ctx.nav, 'foot', Math.floor(inside.x), Math.floor(inside.z))).toBe(true);
    expect(crossing()).toBeNull();
  });

  it('no way with only the bridge, or the bridge and the gate, down', () => {
    const [bridge] = idOf('drawbridge');
    const [gate] = idOf('gate');
    const [portcullis] = idOf('portcullis');
    syncNav(ctx, broken(bridge!.id).structures);
    expect(crossing()).toBeNull();
    syncNav(ctx, broken(bridge!.id, gate!.id).structures);
    expect(crossing()).toBeNull();
    syncNav(ctx, broken(bridge!.id, portcullis!.id).structures);
    expect(crossing()).toBeNull();
  });

  it('with bridge, gate and portcullis down a way exists', () => {
    syncNav(ctx, broken(...defs.filter((d) => d.kind !== 'wall').map((d) => d.id)).structures);
    expect(crossing()).not.toBeNull();
  });

  it('the ram of the siege park reaches the gate front once the bridge is down', () => {
    const front = { x: layout.gates[0]!.center.x + outward.x * RAM_FRONT_M, z: layout.gates[0]!.center.z + outward.z * RAM_FRONT_M };
    const ram = state.units.find((u) => u.id === RAM_ID)!;
    const down = broken(idOf('drawbridge')[0]!.id);
    syncNav(ctx, down.structures);
    expect(findPath(ctx.paths, { profile: 'engine', start: cellAt(ram.position), goal: cellAt(front) })).not.toBeNull();
    syncNav(ctx, state.structures);
    expect(findPath(ctx.paths, { profile: 'engine', start: cellAt(ram.position), goal: cellAt(front) })).toBeNull();
  });

  it('a siege weapon can be previewed on the real structures (the gate is shielded by the raised bridge)', () => {
    const gate = idOf('gate')[0]!;
    const r = previewStructureAttack(ctx, state, RAM_ID, gate.id);
    expect(r).toEqual({ ok: false, reason: 'structureShielded' });
  });

  it('a replay with structures gives one hash, before and after a JSON round trip', () => {
    const commands: Command[] = [{ type: 'attackStructure', unitId: CATAPULT_ID, structureId: idOf('wall')[0]!.id }, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'attackStructure', unitId: RAM_ID, structureId: idOf('gate')[0]!.id }];
    const a = replay(ctx, SEED, scenario, commands);
    const b = replay(ctx, SEED, scenario, JSON.parse(JSON.stringify(commands)) as Command[]);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    expect(applyCommand(ctx, state, { type: 'endTurn' }).rejection).toBeNull();
  });
});
