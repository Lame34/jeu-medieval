/**
 * Sappers' works (src/core/battle/moat.ts, siege-works.ts, apply.ts): moat slots filled with
 * fascines, curtain segments undermined. Built on the synthetic castle of siege-fixture.ts, with
 * a deeper ditch (the fixture's 0.25 m dip is too shallow to count as moat) and the moat declared
 * as a loop so that its slots exist.
 */
import { describe, expect, it } from 'vitest';
import {
  TerrainLayer,
  applyCommand,
  cellIndexOf,
  createBattle,
  createBattleContext,
  createTerrainData,
  findPath,
  hashBattleState,
  isPassable,
  replay,
  setHeightAtCorner,
  type BattleContext,
  type BattleState,
  type Command,
  type CommandRejection,
  type GameEvent,
  type MovementProfile,
  type Scenario,
  type UnitSpawn,
  type Vec2,
} from '@core/index.ts';
import { FILL_BELOW_SILL_M, fillCells, fillSiteAt, fillSiteId, fillSurfaceM, moatsOf, type MoatInfo } from '@core/battle/moat.ts';
import { planFill, planUndermine } from '@core/battle/reach.ts';
import { previewFill, previewUndermine, resolveWork, workState } from '@core/battle/siege-works.ts';
import { navSignature, syncNav, type StructureDef } from '@core/battle/structures.ts';
import { cellCenterHeight } from '@core/terrain-data/terrain-data.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, fillRect } from './helpers.ts';
import { IDS, MAP_D, MAP_W, MOAT_X0, MOAT_X1, WALL_X, buildFixture, spawn, withBroken, withUnit } from './siege-fixture.ts';

const S = DEFAULT_RULES.structures;
const D = DEFAULT_RULES.damage;
const M = DEFAULT_RULES.morale;
/** The ditch of this test's castle: deep enough to be under every bank by more than the dip. */
const DITCH_DEPTH_M = -1;
const MOAT_ID = 'moat-test';
const MOAT_CENTRE_X = (MOAT_X0 + MOAT_X1 + 1) / 2;
const MOAT_WIDTH_M = MOAT_X1 - MOAT_X0 + 1;
/** The closed loop of the moat: down the ditch, then a long way round that touches no cell. */
const LOOP_FAR_M = 500;
/** Row the tests work on (slot 1 of the loop). */
const ROW = 5;
/** A row in another slot. */
const FAR_ROW = 15;
/** Attacker, defender, attacker: puts the sappers back in play. */
const END_TURNS: Command[] = [{ type: 'endTurn' }, { type: 'endTurn' }];

const SAPPER = 'att-sap';
const SAPPER_B = 'att-sap2';
const SAPPER_WALL = 'att-sap3';

const MOAT: MoatInfo = {
  id: MOAT_ID,
  centerline: [
    { x: MOAT_CENTRE_X, z: -2 },
    { x: MOAT_CENTRE_X, z: MAP_D + 2 },
    { x: -LOOP_FAR_M, z: MAP_D + 2 },
    { x: -LOOP_FAR_M, z: -2 },
    { x: MOAT_CENTRE_X, z: -2 },
  ],
  widthM: MOAT_WIDTH_M,
  sillM: 0,
};

function units(): UnitSpawn[] {
  return [
    spawn(SAPPER, 'sapper', MOAT_X1 + 1, ROW),
    spawn(SAPPER_B, 'sapper', MOAT_X1 + 1, ROW + 1),
    spawn(SAPPER_WALL, 'sapper', WALL_X - 1, 5),
    spawn(IDS.soldier, 'soldier', 16, 9),
    spawn(IDS.winch, 'towerArcher', 30, 9),
    spawn(IDS.guardA, 'wallGuard', WALL_X, 3),
    spawn(IDS.guardB, 'wallGuard', WALL_X, 5),
    spawn(IDS.near, 'militia', 30, 3),
    spawn(IDS.far, 'militia', 60, 15),
  ];
}

function world(): { ctx: BattleContext; scenario: Scenario; state: BattleState; defs: StructureDef[] } {
  const f = buildFixture(DEFAULT_RULES, units());
  const t = createTerrainData(MAP_W, MAP_D, 1);
  t.layers.set(f.ctx.baseTerrain.layers);
  t.heights.fill(0);
  for (let iz = 0; iz <= MAP_D; iz++) for (let ix = MOAT_X0; ix <= MOAT_X1 + 1; ix++) setHeightAtCorner(t, ix, iz, DITCH_DEPTH_M);
  fillRect(t, MOAT_X0, 0, MOAT_X1, MAP_D - 1, TerrainLayer.Moat);
  const ctx = createBattleContext(t, DEFAULT_RULES, f.ctx.baseDeck, f.defs, [MOAT]);
  return { ctx, scenario: f.scenario, defs: f.defs, state: createBattle(ctx, 'works', f.scenario) };
}

const at = (cx: number, cz: number): Vec2 => centerOf(cx, cz);
const DITCH_POINT = at(MOAT_X0 + 1, ROW);
const SITE = fillSiteId(MOAT_ID, 1);
const OTHER_SITE = fillSiteId(MOAT_ID, 4);

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

const fill = (unitId = SAPPER, p: Vec2 = DITCH_POINT): Command => ({ type: 'fillMoat', unitId, at: p });
const mine = (unitId = SAPPER_WALL, structureId: string = IDS.wallA): Command => ({ type: 'undermine', unitId, structureId });

function reject(ctx: BattleContext, state: BattleState, c: Command): CommandRejection | null {
  return applyCommand(ctx, state, c).rejection;
}

function pathExists(ctx: BattleContext, state: BattleState, profile: MovementProfile, from: Vec2, to: Vec2): boolean {
  syncNav(ctx, state.structures, state.works);
  return findPath(ctx.paths, { profile, start: cellIndexOf(ctx, from), goal: cellIndexOf(ctx, to) }) !== null;
}

function unitOf(state: BattleState, id: string) {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
}

/** Two sappers fill the slot of ROW in one turn. */
function filled(ctx: BattleContext, state: BattleState): BattleState {
  return run(ctx, state, fill(SAPPER), fill(SAPPER_B)).state;
}

describe('moat geometry', () => {
  const { ctx } = world();

  it('moatsOf closes the centreline and takes the highest gate sill', () => {
    const [m] = moatsOf({
      gates: [{ baseHeightM: 2 }, { baseHeightM: 5 }],
      water: [
        { id: 'r', kind: 'river', centerline: [{ x: 0, z: 0 }], widthM: 1, levelM: 0 },
        {
          id: 'm',
          kind: 'moat',
          centerline: [
            { x: 0, z: 0 },
            { x: 4, z: 0 },
            { x: 4, z: 4 },
          ],
          widthM: 6,
          levelM: 1,
        },
      ],
    } as never);
    expect(m).toMatchObject({ id: 'm', widthM: 6, sillM: 5 });
    expect(m?.centerline).toHaveLength(4);
    expect(m?.centerline[3]).toEqual({ x: 0, z: 0 });
  });

  it('moatsOf falls back to the water level without any gate, and tolerates an empty centreline', () => {
    const none = moatsOf({ gates: [], water: [{ id: 'm', kind: 'moat', centerline: [{ x: 1, z: 1 }], widthM: 2, levelM: 3 }] } as never);
    expect(none[0]?.sillM).toBe(3);
    const empty = moatsOf({ gates: [], water: [{ id: 'm', kind: 'moat', centerline: [], widthM: 2, levelM: 3 }] } as never);
    expect(empty[0]?.centerline).toEqual([]);
  });

  it('fillSiteId is prefixed by the moat id and the slot', () => {
    expect(fillSiteId('a', 3)).toBe('fill:a:3');
  });

  it('cuts the ditch into slots, banks excluded, each cell in exactly one slot', () => {
    const seen = new Set<number>();
    for (let slot = 0; slot < MAP_D / S.fillSlotM + 2; slot++) {
      for (const i of fillCells(ctx, fillSiteId(MOAT_ID, slot))) {
        expect(seen.has(i)).toBe(false);
        seen.add(i);
        const cx = i % MAP_W;
        // The ditch plus its sloping banks (cells whose centre dips below the sill).
        expect(cx).toBeGreaterThanOrEqual(MOAT_X0 - 1);
        expect(cx).toBeLessThanOrEqual(MOAT_X1 + 1);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(MAP_D * (MOAT_X1 - MOAT_X0 + 1));
  });

  it('a slot is fillSlotM rows long', () => {
    const rows = new Set(fillCells(ctx, SITE).map((i) => Math.floor(i / MAP_W)));
    expect(rows.size).toBe(S.fillSlotM);
    expect(rows.has(ROW)).toBe(true);
  });

  it('fillSiteAt finds the slot under the ditch and its banks, and null away from it', () => {
    expect(fillSiteAt(ctx, DITCH_POINT)).toBe(SITE);
    expect(fillSiteAt(ctx, at(MOAT_X1 + 1, ROW))).toBe(SITE);
    expect(fillSiteAt(ctx, at(40, ROW))).toBeNull();
  });

  it('fillCells of an unknown site is empty; the surface is FILL_BELOW_SILL_M under the sill', () => {
    expect(fillCells(ctx, 'fill:nope:0')).toEqual([]);
    expect(fillSurfaceM(ctx, SITE)).toBe(MOAT.sillM - FILL_BELOW_SILL_M);
    // An unknown moat has no sill: the surface falls back to 0 under it.
    expect(fillSurfaceM(ctx, 'fill:nope:0')).toBe(-FILL_BELOW_SILL_M);
  });
});

describe('fillMoat and undermine: rejections', () => {
  const { ctx, state } = world();

  it('noSiegeSkill: a soldier cannot fill or undermine', () => {
    expect(reject(ctx, state, fill(IDS.soldier))).toBe('noSiegeSkill');
    expect(reject(ctx, state, mine(IDS.soldier))).toBe('noSiegeSkill');
  });

  it('unknownUnit, unitDead', () => {
    expect(reject(ctx, state, fill('nobody'))).toBe('unknownUnit');
    expect(reject(ctx, withUnit(state, SAPPER, { alive: false }), fill())).toBe('unitDead');
  });

  it('notAMoat: a point on the courtyard', () => {
    expect(reject(ctx, state, fill(SAPPER, at(40, ROW)))).toBe('notAMoat');
  });

  it('workDone: a slot already filled', () => {
    const done = { ...state, works: [{ id: SITE, progress: S.fillTurns, done: true }] };
    expect(reject(ctx, done, fill())).toBe('workDone');
  });

  it('notAWall: undermining a gate; unknownStructure; structureDown', () => {
    expect(reject(ctx, state, mine(SAPPER_WALL, IDS.gate))).toBe('notAWall');
    expect(reject(ctx, state, mine(SAPPER_WALL, 'wall:nope'))).toBe('unknownStructure');
    expect(reject(ctx, withBroken(state, IDS.wallA), mine())).toBe('structureDown');
  });

  it('outOfRange: a sapper far from the slot or from the wall foot', () => {
    expect(reject(ctx, withUnit(state, SAPPER, { position: at(2, ROW) }), fill())).toBe('outOfRange');
    expect(reject(ctx, withUnit(state, SAPPER_WALL, { position: at(14, 5) }), mine())).toBe('outOfRange');
  });

  it('a sapper out of reach walks first, then works, when the turn allows both', () => {
    const away = withUnit(state, SAPPER, { position: at(5, ROW) });
    const toFill = planFill(ctx, away, SAPPER, DITCH_POINT);
    expect(toFill?.move).not.toBeNull();
    expect(run(ctx, away, { type: 'move', unitId: SAPPER, to: toFill!.move!.destination }, fill()).rejections).toEqual([null, null]);
    const walling = withUnit(state, SAPPER_WALL, { position: at(16, 5) });
    const toMine = planUndermine(ctx, walling, SAPPER_WALL, IDS.wallA);
    expect(toMine?.move).not.toBeNull();
    expect(run(ctx, walling, { type: 'move', unitId: SAPPER_WALL, to: toMine!.move!.destination }, mine()).rejections).toEqual([null, null]);
  });

  it('noActionLeft and insufficientAp', () => {
    expect(reject(ctx, withUnit(state, SAPPER, { actions: 0 }), fill())).toBe('noActionLeft');
    expect(reject(ctx, withUnit(state, SAPPER, { ap: D.attackApCost - 1 }), fill())).toBe('insufficientAp');
    expect(reject(ctx, withUnit(state, SAPPER_WALL, { actions: 0 }), mine())).toBe('noActionLeft');
  });

  it('notYourTurn: after the attacker ends its turn', () => {
    const { state: theirs } = run(ctx, state, { type: 'endTurn' });
    expect(reject(ctx, theirs, fill())).toBe('notYourTurn');
    expect(reject(ctx, theirs, mine())).toBe('notYourTurn');
  });

  it('unitFleeing: a sapper below fleeBelow, but not at fleeBelow', () => {
    expect(reject(ctx, withUnit(state, SAPPER, { morale: M.fleeBelow - 1 }), fill())).toBe('unitFleeing');
    expect(reject(ctx, withUnit(state, SAPPER_WALL, { morale: M.fleeBelow - 1 }), mine())).toBe('unitFleeing');
    expect(reject(ctx, withUnit(state, SAPPER, { morale: M.fleeBelow }), fill())).toBeNull();
  });

  it('a rejection leaves the state untouched', () => {
    const r = applyCommand(ctx, state, fill(IDS.soldier));
    expect(r.state).toBe(state);
    expect(r.events.map((e) => e.type)).toEqual(['commandRejected']);
  });

  it('the previews agree with the commands', () => {
    expect(previewFill(ctx, state, SAPPER, DITCH_POINT).ok).toBe(true);
    expect(previewFill(ctx, state, IDS.soldier, DITCH_POINT)).toEqual({ ok: false, reason: 'noSiegeSkill' });
    expect(previewUndermine(ctx, state, SAPPER_WALL, IDS.wallA).ok).toBe(true);
  });
});

describe('a turn of work', () => {
  const { ctx, state } = world();

  it('one turn: AP and action to 0, guard dropped, progress 1, event emitted', () => {
    const guarding = withUnit(state, SAPPER, { overwatch: { x: 1, z: 0 } });
    const r = run(ctx, guarding, fill());
    expect(r.rejections).toEqual([null]);
    const u = unitOf(r.state, SAPPER);
    expect(u.ap).toBe(0);
    expect(u.actions).toBe(0);
    expect(u.overwatch).toBeNull();
    expect(workState(r.state, SITE)).toEqual({ id: SITE, progress: 1, done: false });
    expect(r.events).toContainEqual({ type: 'siegeWorkProgressed', unitId: SAPPER, workId: SITE, kind: 'fill', progress: 1, required: S.fillTurns });
    expect(r.events.some((e) => e.type === 'moatFilled')).toBe(false);
  });

  it('the sapper faces the work (west, towards the ditch)', () => {
    const u = unitOf(run(ctx, state, fill()).state, SAPPER);
    expect(u.facing.x).toBeLessThan(0);
  });

  it('the same sapper cannot work twice in one turn', () => {
    expect(run(ctx, state, fill(), fill()).rejections).toEqual([null, 'noActionLeft']);
  });

  it('the progress belongs to the site: a second sapper carries on and completes it', () => {
    const r = run(ctx, state, fill(SAPPER), fill(SAPPER_B));
    expect(r.rejections).toEqual([null, null]);
    expect(workState(r.state, SITE)).toEqual({ id: SITE, progress: S.fillTurns, done: true });
    expect(r.events.filter((e) => e.type === 'moatFilled')).toEqual([{ type: 'moatFilled', workId: SITE, byId: SAPPER_B }]);
  });

  it('progress survives the death of the first sapper', () => {
    const r1 = run(ctx, state, fill(), ...END_TURNS);
    const dead = withUnit(r1.state, SAPPER, { alive: false });
    expect(workState(dead, SITE)?.progress).toBe(1);
    expect(workState(run(ctx, dead, fill(SAPPER_B)).state, SITE)?.done).toBe(true);
  });

  it('a filled slot is refused afterwards; other slots have no work', () => {
    const done = filled(ctx, state);
    expect(reject(ctx, withUnit(done, SAPPER_WALL, { position: at(MOAT_X1 + 1, ROW) }), fill(SAPPER_WALL, at(MOAT_X1, ROW)))).toBe('workDone');
    expect(workState(done, OTHER_SITE)).toBeUndefined();
  });

  it('works stay sorted by id', () => {
    const base = withUnit(state, SAPPER_WALL, { position: at(MOAT_X1 + 1, FAR_ROW) });
    const r = run(ctx, base, mine(SAPPER_B, IDS.wallA), fill(SAPPER_WALL, at(MOAT_X0 + 1, FAR_ROW)), fill(SAPPER));
    const ids = r.state.works.map((w) => w.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(ids).toEqual([...ids].sort());
  });

  it('resolveWork keeps the battle ongoing while enemies remain', () => {
    const p = previewFill(ctx, state, SAPPER, DITCH_POINT);
    if (!p.ok) throw new Error('preview');
    expect(resolveWork(ctx, state, p.preview).state.status).toBe('ongoing');
  });
});

describe('fascines open the ditch', () => {
  const START = at(MOAT_X0 - 3, ROW);
  const BANK = at(MOAT_X1 + 2, ROW);
  const PROFILES: MovementProfile[] = ['foot', 'engine'];

  it('no path across the moat for foot and engine before; one afterwards', () => {
    const { ctx, state } = world();
    for (const p of PROFILES) expect(pathExists(ctx, state, p, START, BANK)).toBe(false);
    const half = run(ctx, state, fill()).state;
    for (const p of PROFILES) expect(pathExists(ctx, half, p, START, BANK)).toBe(false);
    const done = filled(ctx, state);
    for (const p of PROFILES) expect(pathExists(ctx, done, p, START, BANK)).toBe(true);
  });

  it('a filled slot leaves the cells of the other slots water', () => {
    const { ctx, state } = world();
    const done = filled(ctx, state);
    syncNav(ctx, done.structures, done.works);
    expect(isPassable(ctx.nav, 'foot', MOAT_X0 + 1, FAR_ROW)).toBe(false);
    expect(isPassable(ctx.nav, 'foot', MOAT_X0 + 1, ROW)).toBe(true);
  });

  it('the slot cells are Fascine with a deck of fillSurfaceM minus relief, never negative', () => {
    const { ctx, state } = world();
    const done = filled(ctx, state);
    syncNav(ctx, done.structures, done.works);
    const cells = fillCells(ctx, SITE);
    expect(cells.length).toBeGreaterThan(0);
    const surface = fillSurfaceM(ctx, SITE);
    for (const i of cells) {
      const deck = surface - cellCenterHeight(ctx.baseTerrain, i % MAP_W, Math.floor(i / MAP_W));
      expect(deck).toBeGreaterThanOrEqual(0);
      expect(ctx.nav.terrain.layers[i]).toBe(TerrainLayer.Fascine);
      expect(ctx.nav.deck[i]).toBeCloseTo(deck, 5);
    }
    expect(ctx.nav.terrain.layers[FAR_ROW * MAP_W + MOAT_X0 + 1]).toBe(TerrainLayer.Moat);
    expect(fillCells(ctx, OTHER_SITE)).toContain(FAR_ROW * MAP_W + MOAT_X0 + 1);
  });

  it('navSignature lists the filled sites only, after the broken structures', () => {
    const { state } = world();
    expect(navSignature(state.structures, state.works)).toBe('');
    const works = [
      { id: SITE, progress: 1, done: false },
      { id: OTHER_SITE, progress: 2, done: true },
      { id: `mine:${IDS.wallA}`, progress: 3, done: true },
    ];
    expect(navSignature(state.structures, works)).toBe(OTHER_SITE);
    expect(navSignature(withBroken(state, IDS.wallA).structures, works)).toBe(`${IDS.wallA}|${OTHER_SITE}`);
    const done = filled(world().ctx, state);
    expect(navSignature(done.structures, done.works)).toContain(SITE);
  });

  it('syncNav builds a grid once per combination and reuses it from the cache', () => {
    const { ctx, state } = world();
    const done = filled(ctx, state);
    syncNav(ctx, done.structures, done.works);
    const withFascines = ctx.nav;
    syncNav(ctx, state.structures, state.works);
    expect(ctx.nav).not.toBe(withFascines);
    syncNav(ctx, done.structures, [...done.works]);
    expect(ctx.nav).toBe(withFascines);
    // Work in progress does not change the grid.
    const half = run(ctx, state, fill()).state;
    syncNav(ctx, state.structures, state.works);
    const bare = ctx.nav;
    syncNav(ctx, half.structures, half.works);
    expect(ctx.nav).toBe(bare);
  });

  it('only the swimmer crosses the open water', () => {
    const { ctx } = world();
    expect(isPassable(ctx.nav, 'lightFoot', MOAT_X0 + 1, ROW)).toBe(true);
    expect(isPassable(ctx.nav, 'foot', MOAT_X0 + 1, ROW)).toBe(false);
  });
});

describe('undermining a curtain segment', () => {
  const { ctx, state } = world();

  /** `turns` turns of work by the wall sapper, ending each turn but the last. */
  function mined(turns: number): { state: BattleState; events: GameEvent[] } {
    let s = state;
    const events: GameEvent[] = [];
    for (let k = 0; k < turns; k++) {
      const r = run(ctx, s, mine(), ...(k < turns - 1 ? END_TURNS : []));
      expect(r.rejections[0]).toBeNull();
      s = r.state;
      events.push(...r.events);
    }
    return { state: s, events };
  }

  it('turns before the last leave the wall standing and keep count', () => {
    const r = mined(S.mineTurns - 1);
    const id = `mine:${IDS.wallA}`;
    expect(workState(r.state, id)).toEqual({ id, progress: S.mineTurns - 1, done: false });
    expect(r.state.structures.find((s) => s.id === IDS.wallA)?.broken).toBe(false);
    expect(r.events.some((e) => e.type === 'structureBroken')).toBe(false);
  });

  it('the mineTurns-th turn collapses the segment: structureBroken by the sapper, fall damage, morale', () => {
    const r = mined(S.mineTurns);
    expect(r.state.structures.find((s) => s.id === IDS.wallA)).toMatchObject({ hp: 0, broken: true });
    expect(workState(r.state, `mine:${IDS.wallA}`)?.done).toBe(true);
    const broken = r.events.find((e): e is Extract<GameEvent, { type: 'structureBroken' }> => e.type === 'structureBroken');
    expect(broken).toMatchObject({ structureId: IDS.wallA, kind: 'wall', byId: SAPPER_WALL });
    expect(broken?.fallen.map((f) => f.unitId).sort()).toEqual([IDS.guardA, IDS.guardB]);
    const guardHp = DEFAULT_RULES.units.wallGuard?.hp ?? 0;
    for (const id of [IDS.guardA, IDS.guardB]) expect(unitOf(r.state, id).hp).toBeLessThanOrEqual(guardHp - S.fallDamage);
    const morale = r.events.filter((e): e is Extract<GameEvent, { type: 'moraleChanged' }> => e.type === 'moraleChanged' && e.reason === 'wallCollapsed');
    expect(morale.length).toBeGreaterThan(0);
    expect(morale.some((e) => e.unitId === IDS.far)).toBe(false);
    // The wall is now rubble the infantry can cross, and a further undermine is refused.
    expect(isPassable(ctx.nav, 'foot', WALL_X, 5)).toBe(true);
    expect(reject(ctx, r.state, mine(SAPPER_B))).toBe('structureDown');
  });

  it('a second sapper carries on the mine of the first', () => {
    const first = run(ctx, state, mine(SAPPER_WALL), ...END_TURNS);
    const moved = withUnit(first.state, SAPPER_B, { position: at(WALL_X - 1, 6) });
    const second = run(ctx, moved, mine(SAPPER_B));
    expect(second.events).toContainEqual({ type: 'siegeWorkProgressed', unitId: SAPPER_B, workId: `mine:${IDS.wallA}`, kind: 'mine', progress: 2, required: S.mineTurns });
  });

  it('guards killed by the fall emit unitDied', () => {
    let s = withUnit(withUnit(state, IDS.guardA, { hp: S.fallDamage }), IDS.guardB, { hp: S.fallDamage });
    const died: string[] = [];
    for (let k = 0; k < S.mineTurns; k++) {
      const r = run(ctx, s, mine(), ...(k < S.mineTurns - 1 ? END_TURNS : []));
      s = r.state;
      for (const e of r.events) if (e.type === 'unitDied') died.push(e.unitId);
    }
    expect(died.sort()).toEqual([IDS.guardA, IDS.guardB]);
    expect(unitOf(s, IDS.guardA).alive).toBe(false);
  });

  it('battleEnded is emitted when the last defender falls with the wall', () => {
    const lone = buildFixture(DEFAULT_RULES, [spawn(SAPPER_WALL, 'sapper', WALL_X - 1, 5), spawn(IDS.guardA, 'wallGuard', WALL_X, 3)]);
    let s = withUnit(createBattle(lone.ctx, 'lone', lone.scenario), IDS.guardA, { hp: 1 });
    const all: GameEvent[] = [];
    for (let k = 0; k < S.mineTurns; k++) {
      const r = run(lone.ctx, s, mine(), ...(k < S.mineTurns - 1 ? END_TURNS : []));
      s = r.state;
      all.push(...r.events);
    }
    expect(all.some((e) => e.type === 'battleEnded')).toBe(true);
    expect(s.status).not.toBe('ongoing');
  });
});

describe('determinism of the works', () => {
  const SEED = 'works-replay';
  const SEQUENCE: Command[] = [fill(SAPPER), fill(SAPPER_B), ...END_TURNS, mine(SAPPER_WALL), ...END_TURNS, mine(SAPPER_WALL), ...END_TURNS, mine(SAPPER_WALL), { type: 'endTurn' }];

  it('replays to the same hash every time, and after a JSON round trip of the commands', () => {
    const a = world();
    const b = world();
    const c = world();
    const first = replay(a.ctx, SEED, a.scenario, SEQUENCE);
    const second = replay(b.ctx, SEED, b.scenario, SEQUENCE);
    const trip = replay(c.ctx, SEED, c.scenario, JSON.parse(JSON.stringify(SEQUENCE)) as Command[]);
    expect(hashBattleState(second.state)).toBe(hashBattleState(first.state));
    expect(hashBattleState(trip.state)).toBe(hashBattleState(first.state));
    expect(trip.events).toEqual(first.events);
    expect(first.state.works.filter((w) => w.done)).toHaveLength(2);
    expect(first.state.structures.find((s) => s.id === IDS.wallA)?.broken).toBe(true);
  });

  it('works change the hash, and a state survives a JSON round trip', () => {
    const a = world();
    const none = replay(a.ctx, SEED, a.scenario, []);
    const some = replay(a.ctx, SEED, a.scenario, [fill(SAPPER)]);
    expect(hashBattleState(some.state)).not.toBe(hashBattleState(none.state));
    expect(hashBattleState(JSON.parse(JSON.stringify(some.state)) as BattleState)).toBe(hashBattleState(some.state));
  });

  it('a state restored from JSON carries on with the same outcome', () => {
    const a = world();
    const mid = replay(a.ctx, SEED, a.scenario, SEQUENCE.slice(0, 3)).state;
    const restored = JSON.parse(JSON.stringify(mid)) as BattleState;
    const rest = SEQUENCE.slice(3);
    expect(hashBattleState(run(a.ctx, restored, ...rest).state)).toBe(hashBattleState(run(a.ctx, mid, ...rest).state));
  });
});
