/**
 * The siege tower (src/core/battle/siege-tower.ts, commands dockTower / climbTower): docking against
 * a curtain segment, climbing onto the wall-walk, the capacity per turn and the release of the dock.
 * Built on the synthetic castle of siege-fixture.ts (curtain at x = 20, S0 on z 0..7, deck 4 m).
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, hashBattleState, replay, type BattleContext, type BattleState, type Command, type CommandRejection, type GameEvent, type UnitSpawn } from '@core/index.ts';
import { dockOf, previewClimb, previewDock, refillDocks, releaseDocks } from '@core/battle/siege-tower.ts';
import { deckAt } from '@core/battle/context.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { IDS, WALL_X, S0_Z1, WALL_DECK_M, buildFixture, spawn, withBroken, withUnit } from './siege-fixture.ts';
import { centerOf } from './helpers.ts';
import { createBattle } from '@core/index.ts';

const S = DEFAULT_RULES.structures;
const D = DEFAULT_RULES.damage;
const TOWER = 'att-tower';
const SEED = 'siege-tower-tests';
/** Row the tower stands on, one cell from the curtain. */
const TOWER_Z = 4;
const TOWER_X = WALL_X - 1;
/** Soldiers standing around the tower's foot (all within CLIMB reach). */
const FOOT = [
  [TOWER_X - 1, TOWER_Z - 1],
  [TOWER_X - 1, TOWER_Z],
  [TOWER_X - 1, TOWER_Z + 1],
  [TOWER_X, TOWER_Z - 2],
  [TOWER_X, TOWER_Z + 2],
] as const;
const SOLDIERS = FOOT.map((_, i) => `att-s${i}`);
const MAX_UNITS_ON_WALL = S0_Z1 + 1;
/** Attacker, defender, attacker: a new turn for the attackers. */
const NEW_TURN: Command[] = [{ type: 'endTurn' }, { type: 'endTurn' }];
const OVERWATCH_DIR = { x: 1, z: 0 };

function units(extra: UnitSpawn[] = []): UnitSpawn[] {
  return [
    spawn(TOWER, 'siegeTower', TOWER_X, TOWER_Z),
    ...FOOT.map(([x, z], i) => spawn(SOLDIERS[i] as string, 'soldier', x, z)),
    spawn(IDS.guardA, 'wallGuard', WALL_X, 3),
    spawn(IDS.guardB, 'wallGuard', WALL_X, 5),
    spawn('def-far', 'militia', 60, 15),
    ...extra,
  ];
}

function world(extra: UnitSpawn[] = []): { ctx: BattleContext; state: BattleState } {
  const f = buildFixture(DEFAULT_RULES, units(extra));
  return { ctx: f.ctx, state: createBattle(f.ctx, SEED, f.scenario) };
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

const dock = (unitId = TOWER, structureId: string = IDS.wallA): Command => ({ type: 'dockTower', unitId, structureId });
const climb = (unitId: string, towerId = TOWER): Command => ({ type: 'climbTower', unitId, towerId });
const rejection = (ctx: BattleContext, state: BattleState, c: Command): CommandRejection | null => applyCommand(ctx, state, c).rejection;
const unitOf = (state: BattleState, id: string) => {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};

describe('dockTower', () => {
  it('docks against the wall: the tower stops, faces the wall and the dock is recorded', () => {
    const { ctx, state } = world();
    const r = run(ctx, withUnit(state, TOWER, { overwatch: OVERWATCH_DIR }), dock());
    expect(r.rejections).toEqual([null]);
    expect(r.events).toContainEqual({ type: 'towerDocked', towerId: TOWER, structureId: IDS.wallA });
    expect(r.state.docks).toEqual([{ towerId: TOWER, structureId: IDS.wallA, climbs: 0 }]);
    expect(dockOf(r.state, TOWER)).toBeDefined();
    expect(dockOf(r.state, 'nobody')).toBeUndefined();
    const tower = unitOf(r.state, TOWER);
    expect(tower.ap).toBe(0);
    expect(tower.actions).toBe(0);
    expect(tower.overwatch).toBeNull();
    expect(tower.facing.x).toBeGreaterThan(0);
  });

  it('rejects every invalid dock', () => {
    const { ctx, state } = world();
    const docked = run(ctx, state, dock()).state;
    const cases: [string, BattleState, Command, CommandRejection][] = [
      ['soldier is no tower', state, dock(SOLDIERS[0] as string), 'notATower'],
      ['already docked', docked, dock(), 'alreadyDocked'],
      ['gate is no wall', state, dock(TOWER, IDS.gate), 'notAWall'],
      ['unknown structure', state, dock(TOWER, 'wall:nope'), 'unknownStructure'],
      ['segment down', withBroken(state, IDS.wallA), dock(), 'structureDown'],
      ['too far', withUnit(state, TOWER, { position: centerOf(WALL_X - 6, TOWER_Z) }), dock(), 'outOfRange'],
      ['no action', withUnit(state, TOWER, { actions: 0 }), dock(), 'noActionLeft'],
      ['no AP', withUnit(state, TOWER, { ap: D.attackApCost - 1 }), dock(), 'insufficientAp'],
      ['unknown unit', state, dock('ghost'), 'unknownUnit'],
      ['dead tower', withUnit(state, TOWER, { alive: false, hp: 0 }), dock(), 'unitDead'],
      ['wrong faction', withUnit(state, TOWER, {}), { type: 'dockTower', unitId: IDS.guardA, structureId: IDS.wallA }, 'notYourTurn'],
    ];
    for (const [name, s, c, expected] of cases) expect(rejection(ctx, s, c), name).toBe(expected);
  });

  it('previewDock reports the reason without touching the state', () => {
    const { ctx, state } = world();
    const ok = previewDock(ctx, state, TOWER, IDS.wallA);
    expect(ok).toEqual({ ok: true, preview: { towerId: TOWER, structureId: IDS.wallA } });
    const hash = hashBattleState(state);
    expect(previewDock(ctx, state, TOWER, IDS.gate)).toEqual({ ok: false, reason: 'notAWall' });
    expect(hashBattleState(state)).toBe(hash);
  });

  it('docks within towerDockReachM and not beyond it', () => {
    const { ctx, state } = world();
    const near = withUnit(state, TOWER, { position: centerOf(WALL_X - Math.floor(S.towerDockReachM), TOWER_Z) });
    expect(rejection(ctx, near, dock())).toBeNull();
    const far = withUnit(state, TOWER, { position: centerOf(WALL_X - Math.ceil(S.towerDockReachM) - 1, TOWER_Z) });
    expect(rejection(ctx, far, dock())).toBe('outOfRange');
  });

  it('a docked tower refuses to move (towerDocked), even with AP again', () => {
    const { ctx, state } = world();
    const docked = run(ctx, state, dock()).state;
    const again = run(ctx, docked, ...NEW_TURN).state;
    expect(unitOf(again, TOWER).ap).toBeGreaterThan(0);
    expect(rejection(ctx, again, { type: 'move', unitId: TOWER, to: centerOf(TOWER_X - 2, TOWER_Z) })).toBe('towerDocked');
  });
});

describe('climbTower', () => {
  const docked = (): { ctx: BattleContext; state: BattleState } => {
    const w = world();
    return { ctx: w.ctx, state: run(w.ctx, w.state, dock()).state };
  };

  it('puts the unit on the docked segment, on the deck, 2 AP lighter and off guard', () => {
    const { ctx, state } = docked();
    const soldier = SOLDIERS[1] as string;
    const before = unitOf(withUnit(state, soldier, { overwatch: OVERWATCH_DIR }), soldier);
    const r = run(ctx, withUnit(state, soldier, { overwatch: OVERWATCH_DIR }), climb(soldier));
    expect(r.rejections).toEqual([null]);
    const after = unitOf(r.state, soldier);
    const cell = Math.floor(after.position.z) * ctx.nav.width + Math.floor(after.position.x);
    expect(S.towerClimbAp).toBe(2);
    expect(after.ap).toBe(before.ap - S.towerClimbAp);
    expect(after.overwatch).toBeNull();
    expect(Math.floor(after.position.x)).toBe(WALL_X);
    expect(ctx.structures.find((d) => d.id === IDS.wallA)?.cells).toContain(cell);
    expect(deckAt(ctx, after.position)).toBe(WALL_DECK_M);
    expect(after.facing.x).toBeGreaterThan(0);
    expect(r.state.docks[0]?.climbs).toBe(1);
    expect(r.events).toContainEqual({ type: 'unitClimbed', unitId: soldier, towerId: TOWER, from: before.position, to: after.position });
  });

  it('lands on the free cell nearest the tower', () => {
    const { ctx, state } = docked();
    const preview = previewClimb(ctx, state, SOLDIERS[1] as string, TOWER);
    if (!preview.ok) throw new Error('climb refused');
    // The tower stands at z 4.5; guards hold z 3 and 5: the nearest free cells are z 4 (the tower's row).
    expect(preview.preview.to).toEqual(centerOf(WALL_X, TOWER_Z));
    expect(preview.preview.apCost).toBe(S.towerClimbAp);
  });

  it('carries towerCapacity units per turn, the next one is refused, and the count resets next turn', () => {
    const { ctx, state } = docked();
    expect(S.towerCapacity).toBe(4);
    const climbers = SOLDIERS.slice(0, S.towerCapacity).map((id) => climb(id));
    const r = run(ctx, state, ...climbers);
    expect(r.rejections.every((x) => x === null)).toBe(true);
    expect(r.state.docks[0]?.climbs).toBe(S.towerCapacity);
    expect(rejection(ctx, r.state, climb(SOLDIERS[S.towerCapacity] as string))).toBe('towerFull');
    const next = run(ctx, r.state, ...NEW_TURN).state;
    expect(next.docks[0]?.climbs).toBe(0);
    expect(rejection(ctx, next, climb(SOLDIERS[S.towerCapacity] as string))).toBeNull();
  });

  it('refillDocks leaves an untouched state as it is', () => {
    const { state } = docked();
    expect(refillDocks(state)).toBe(state);
  });

  it('rejects every invalid climb', () => {
    const { ctx, state } = docked();
    const soldier = SOLDIERS[1] as string;
    const w = world(); // not docked
    const cavalry = world([spawn('att-horse', 'cavalry', TOWER_X - 1, TOWER_Z + 2), spawn('att-ram', 'ram', TOWER_X - 2, TOWER_Z)]);
    const cavalryDocked = run(cavalry.ctx, cavalry.state, dock()).state;
    const cases: [string, BattleContext, BattleState, Command, CommandRejection][] = [
      ['not docked', w.ctx, w.state, climb(soldier), 'notDocked'],
      ['unknown tower', ctx, state, climb(soldier, 'ghost'), 'notDocked'],
      ['dead tower', ctx, withUnit(state, TOWER, { alive: false, hp: 0 }), climb(soldier), 'notDocked'],
      ['an engine cannot climb', cavalry.ctx, cavalryDocked, climb('att-ram'), 'cannotClimb'],
      ['a rider cannot climb', cavalry.ctx, cavalryDocked, climb('att-horse'), 'cannotClimb'],
      ['too far from the foot', ctx, withUnit(state, soldier, { position: centerOf(TOWER_X - 6, TOWER_Z) }), climb(soldier), 'outOfRange'],
      ['not enough AP', ctx, withUnit(state, soldier, { ap: S.towerClimbAp - 1 }), climb(soldier), 'insufficientAp'],
      ['fleeing', ctx, withUnit(state, soldier, { morale: 0 }), climb(soldier), 'unitFleeing'],
      ['unknown unit', ctx, state, climb('ghost'), 'unknownUnit'],
      ['dead unit', ctx, withUnit(state, soldier, { alive: false, hp: 0 }), climb(soldier), 'unitDead'],
      ['enemy unit', ctx, state, climb(IDS.guardA), 'notYourTurn'],
    ];
    for (const [name, c, s, cmd, expected] of cases) expect(rejection(c, s, cmd), name).toBe(expected);
  });

  it('refuses when the wall-walk has no free cell (noRoomOnWall)', () => {
    // Defenders on every cell of S0 but the guards' own are already there: fill the remaining ones.
    const filler = Array.from({ length: MAX_UNITS_ON_WALL }, (_, z) => z)
      .filter((z) => z !== 3 && z !== 5)
      .map((z) => spawn(`def-fill-${z}`, 'wallGuard', WALL_X, z));
    const w = world(filler);
    const state = run(w.ctx, w.state, dock()).state;
    expect(rejection(w.ctx, state, climb(SOLDIERS[0] as string))).toBe('noRoomOnWall');
  });
});

describe('release of the dock', () => {
  const docked = (): { ctx: BattleContext; state: BattleState } => {
    const w = world();
    return { ctx: w.ctx, state: run(w.ctx, w.state, dock()).state };
  };

  it('is broken when the segment falls', () => {
    const { ctx, state } = docked();
    const r = run(ctx, withBroken(state, IDS.wallA), { type: 'endTurn' });
    expect(r.events).toContainEqual({ type: 'towerUndocked', towerId: TOWER });
    expect(r.state.docks).toEqual([]);
  });

  it('is broken when the tower dies', () => {
    const { ctx, state } = docked();
    const r = run(ctx, withUnit(state, TOWER, { alive: false, hp: 0 }), { type: 'endTurn' });
    expect(r.events).toContainEqual({ type: 'towerUndocked', towerId: TOWER });
    expect(r.state.docks).toEqual([]);
  });

  it('releaseDocks keeps a healthy dock untouched and appends nothing', () => {
    const { state } = docked();
    const events: GameEvent[] = [];
    expect(releaseDocks(state, events)).toBe(state);
    expect(events).toEqual([]);
  });

  it('a released tower can move again', () => {
    const { ctx, state } = docked();
    const freed = run(ctx, withBroken(state, IDS.wallA), { type: 'endTurn' }, { type: 'endTurn' }).state;
    expect(rejection(ctx, freed, { type: 'move', unitId: TOWER, to: centerOf(TOWER_X - 1, TOWER_Z) })).not.toBe('towerDocked');
  });
});

describe('determinism', () => {
  it('replays to the same hash, also after a JSON round trip of the commands', () => {
    const w = world();
    const f = buildFixture(DEFAULT_RULES, units());
    const commands: Command[] = [dock(), climb(SOLDIERS[0] as string), climb(SOLDIERS[1] as string), ...NEW_TURN, climb(SOLDIERS[2] as string)];
    const a = replay(w.ctx, SEED, f.scenario, commands);
    const b = replay(w.ctx, SEED, f.scenario, JSON.parse(JSON.stringify(commands)) as Command[]);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    expect(a.state.docks[0]?.climbs).toBe(1);
  });
});
