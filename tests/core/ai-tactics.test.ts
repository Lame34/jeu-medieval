/**
 * Siege tactics of the AI (src/core/ai/tactics.ts, ADR-030): putting out fires, fire arrows, the
 * garrison behind a breach, sallies, and the objectives of rams, sappers and towers. Every case is a
 * small hand-built scenario on the synthetic castle of siege-fixture.ts (curtain at x = 20, gate
 * rows z 8..10, moat x 10..13), with a Field patch laid on the courtyard where fire needs fuel.
 */
import { describe, expect, it } from 'vitest';
import {
  TerrainLayer,
  applyCommand,
  createBattle,
  createBattleContext,
  createTerrainData,
  decideUnit,
  hashBattleState,
  playTurn,
  setHeightAtCorner,
  type BattleContext,
  type BattleState,
  type Command,
  type Faction,
  type UnitSpawn,
  type UnitState,
  type Vec2,
} from '@core/index.ts';
import { TACTIC_WEIGHTS, breachGuardValue, cellsWithinReach, fireDecisions, sallyTarget, stagingOrigins, worthyFillSites } from '@core/ai/tactics.ts';
import { fillSiteId, type MoatInfo } from '@core/battle/moat.ts';
import { syncNav } from '@core/battle/structures.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, fillRect } from './helpers.ts';
import { IDS, MAP_D, MAP_W, MOAT_X0, MOAT_X1, WALL_X, buildFixture, spawn, withBroken, withUnit } from './siege-fixture.ts';

const W = TACTIC_WEIGHTS;
const F = DEFAULT_RULES.fire;
const SEED = 'ai-tactics';
/** The Field patch in the courtyard, x 40..49, z 2..9. */
const FIELD = { x0: 40, z0: 2, x1: 49, z1: 9 };
const ENEMY_ON_FIELD = { x: 44, z: 5 };
/** A cell far from every scenario (nothing flammable around it). */
const FAR_CORNER = { x: 3, z: 3 };
const GATE_FIRE = { x: WALL_X, z: 9 };
const NEXT_TO_GATE = { x: WALL_X + 1, z: 9 };
const ARCHER_AT_BRIDGE = { x: 16, z: 9 };
const BRIDGE_MID = { x: 12, z: 9 };
const DEFENDER = 'def-guard';
const ATT_ARCHER = 'att-archer';
const ATT_SOLDIER = 'att-sold';

const idx = (x: number, z: number): number => z * MAP_W + x;
const pt = (x: number, z: number): Vec2 => centerOf(x, z);

function unitOf(state: BattleState, id: string): UnitState {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
}

interface World {
  ctx: BattleContext;
  state: BattleState;
}

/** The synthetic castle with a Field patch, the given units, and `first` to play. */
function world(units: UnitSpawn[], first: Faction, seed = SEED): World {
  const f = buildFixture(DEFAULT_RULES, units);
  const t = createTerrainData(MAP_W, MAP_D, 1);
  t.layers.set(f.ctx.baseTerrain.layers);
  t.heights.set(f.ctx.baseTerrain.heights);
  fillRect(t, FIELD.x0, FIELD.z0, FIELD.x1, FIELD.z1, TerrainLayer.Field);
  const ctx = createBattleContext(t, DEFAULT_RULES, f.ctx.baseDeck, f.defs);
  return { ctx, state: createBattle(ctx, seed, { units, firstFaction: first }) };
}

/** `state` with the given cells ablaze. */
function burning(state: BattleState, ...cells: number[]): BattleState {
  return { ...state, fires: cells.map((cell) => ({ cell, turnsLeft: F.woodTurns })).sort((a, b) => a.cell - b.cell) };
}

const extinguishOf = (decisions: ReturnType<typeof fireDecisions>) => decisions.filter((d) => d.commands[0]?.type === 'extinguish');
const arrowsOf = (decisions: ReturnType<typeof fireDecisions>) => decisions.filter((d) => d.commands[0]?.type === 'fireArrow');

describe('extinguish decisions', () => {
  const baseUnits = (extra: UnitSpawn[] = []): UnitSpawn[] => [
    spawn(DEFENDER, 'wallGuard', NEXT_TO_GATE.x, NEXT_TO_GATE.z),
    spawn(ATT_SOLDIER, 'soldier', FAR_CORNER.x, FAR_CORNER.z),
    ...extra,
  ];

  it('a defender beside a burning gate puts it out, scoring base + itself + the own-timber bonus', () => {
    const { ctx, state } = world(baseUnits(), 'defender');
    const lit = burning(state, idx(GATE_FIRE.x, GATE_FIRE.z));
    const decisions = extinguishOf(fireDecisions(ctx, lit, unitOf(lit, DEFENDER)));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.commands).toEqual([{ type: 'extinguish', unitId: DEFENDER, at: pt(GATE_FIRE.x, GATE_FIRE.z) }]);
    expect(decisions[0]?.score).toBe(W.extinguishBase + W.extinguishPerFriend + W.extinguishOwnTimber);
  });

  it('the score grows with every ally within threatRadiusM of the fire, not with those farther or with enemies', () => {
    const near = [spawn('def-a', 'militia', WALL_X + 2, 9), spawn('def-b', 'militia', WALL_X + 2, 10)];
    const faraway = spawn('def-c', 'militia', WALL_X + Math.ceil(W.threatRadiusM) + 5, 9);
    const scoreWith = (extra: UnitSpawn[]): number => {
      const w = world(baseUnits(extra), 'defender');
      const lit = burning(w.state, idx(GATE_FIRE.x, GATE_FIRE.z));
      return extinguishOf(fireDecisions(w.ctx, lit, unitOf(lit, DEFENDER)))[0]?.score as number;
    };
    const alone = scoreWith([]);
    expect(scoreWith(near)).toBe(alone + near.length * W.extinguishPerFriend);
    expect(scoreWith([...near, faraway])).toBe(alone + near.length * W.extinguishPerFriend);
    expect(scoreWith([spawn('att-near', 'soldier', WALL_X - 2, 9)])).toBe(alone);
  });

  it('a fire on plain vegetation earns no own-timber bonus for the garrison', () => {
    const { ctx, state } = world([spawn(DEFENDER, 'wallGuard', FIELD.x0 - 1, 5), spawn(ATT_SOLDIER, 'soldier', FAR_CORNER.x, FAR_CORNER.z)], 'defender');
    const lit = burning(state, idx(FIELD.x0, 5));
    const [only] = extinguishOf(fireDecisions(ctx, lit, unitOf(lit, DEFENDER)));
    expect(only?.score).toBe(W.extinguishBase + W.extinguishPerFriend);
  });

  it('considers nothing beyond fire.extinguishReachM, nor with no action left', () => {
    const { ctx, state } = world(baseUnits(), 'defender');
    const lit = burning(state, idx(GATE_FIRE.x, GATE_FIRE.z));
    const beyond = Math.ceil(F.extinguishReachM) + 1;
    const tooFar = withUnit(lit, DEFENDER, { position: pt(GATE_FIRE.x + 1 + beyond, GATE_FIRE.z) });
    expect(fireDecisions(ctx, tooFar, unitOf(tooFar, DEFENDER))).toEqual([]);
    const spent = withUnit(lit, DEFENDER, { actions: 0 });
    expect(fireDecisions(ctx, spent, unitOf(spent, DEFENDER))).toEqual([]);
  });

  it('decideUnit chooses to extinguish the burning gate rather than hold or wander', () => {
    const { ctx, state } = world(baseUnits(), 'defender');
    const lit = burning(state, idx(GATE_FIRE.x, GATE_FIRE.z));
    syncNav(ctx, lit.structures, lit.works);
    const commands = decideUnit(ctx, lit, unitOf(lit, DEFENDER));
    expect(commands).toEqual([{ type: 'extinguish', unitId: DEFENDER, at: pt(GATE_FIRE.x, GATE_FIRE.z) }]);
    // And the command is legal.
    expect(applyCommand(ctx, lit, commands[0] as Command).rejection).toBeNull();
  });
});

describe('fire arrow decisions', () => {
  it('attackers with a raised drawbridge in sight loose a fire arrow at its timbers', () => {
    const { ctx, state } = world([spawn(ATT_ARCHER, 'archer', ARCHER_AT_BRIDGE.x, ARCHER_AT_BRIDGE.z), spawn(IDS.winch, 'towerArcher', 30, 9)], 'attacker');
    const decisions = arrowsOf(fireDecisions(ctx, state, unitOf(state, ATT_ARCHER)));
    const bridge = decisions.find((d) => JSON.stringify(d.commands) === JSON.stringify([{ type: 'fireArrow', unitId: ATT_ARCHER, at: pt(BRIDGE_MID.x, BRIDGE_MID.z) }]));
    expect(bridge).toBeDefined();
    expect(bridge?.score).toBeGreaterThan(0);
    // Every shot offered is one the rules accept.
    for (const d of decisions) expect(applyCommand(ctx, state, d.commands[0] as Command).rejection).toBeNull();
  });

  it('a lowered drawbridge is no longer a target', () => {
    const { ctx, state } = world([spawn(ATT_ARCHER, 'archer', ARCHER_AT_BRIDGE.x, ARCHER_AT_BRIDGE.z), spawn(IDS.winch, 'towerArcher', 30, 9)], 'attacker');
    const down = withBroken(state, IDS.bridge);
    const aimedAtBridge = arrowsOf(fireDecisions(ctx, down, unitOf(down, ATT_ARCHER))).filter((d) => JSON.stringify(d.commands).includes(JSON.stringify(pt(BRIDGE_MID.x, BRIDGE_MID.z))));
    expect(aimedAtBridge).toEqual([]);
  });

  it('a unit without the fireArrows tag never receives a fire-arrow decision', () => {
    const { ctx, state } = world([spawn(ATT_SOLDIER, 'soldier', ARCHER_AT_BRIDGE.x, ARCHER_AT_BRIDGE.z), spawn(IDS.winch, 'towerArcher', 30, 9)], 'attacker');
    expect(arrowsOf(fireDecisions(ctx, state, unitOf(state, ATT_SOLDIER)))).toEqual([]);
  });

  it('a tower archer aims at burnable ground within blazeRadiusM of an enemy', () => {
    const { ctx, state } = world([spawn(IDS.winch, 'towerArcher', 30, 9), spawn(ATT_SOLDIER, 'soldier', ENEMY_ON_FIELD.x, ENEMY_ON_FIELD.z)], 'defender');
    const decisions = arrowsOf(fireDecisions(ctx, state, unitOf(state, IDS.winch)));
    expect(decisions.length).toBeGreaterThan(0);
    const enemy = unitOf(state, ATT_SOLDIER).position;
    for (const d of decisions) {
      const c = d.commands[0] as Extract<Command, { type: 'fireArrow' }>;
      expect(Math.hypot(c.at.x - enemy.x, c.at.z - enemy.z)).toBeLessThanOrEqual(W.blazeRadiusM);
      expect(ctx.nav.flammable[Math.floor(c.at.z) * MAP_W + Math.floor(c.at.x)]).toBe(1);
      expect(d.score).toBeGreaterThan(0);
    }
  });

  it('no decision when only allies stand in the blaze radius', () => {
    const { ctx, state } = world(
      [spawn(IDS.winch, 'towerArcher', 30, 9), spawn('def-field', 'militia', ENEMY_ON_FIELD.x, ENEMY_ON_FIELD.z), spawn(ATT_SOLDIER, 'soldier', FAR_CORNER.x, FAR_CORNER.z)],
      'defender',
    );
    expect(arrowsOf(fireDecisions(ctx, state, unitOf(state, IDS.winch)))).toEqual([]);
  });

  it('allies in the blaze radius count against a shot (fewer or no decisions than with the enemy alone)', () => {
    const alone = world([spawn(IDS.winch, 'towerArcher', 30, 9), spawn(ATT_SOLDIER, 'soldier', ENEMY_ON_FIELD.x, ENEMY_ON_FIELD.z)], 'defender');
    const crowded = world(
      [
        spawn(IDS.winch, 'towerArcher', 30, 9),
        spawn(ATT_SOLDIER, 'soldier', ENEMY_ON_FIELD.x, ENEMY_ON_FIELD.z),
        spawn('def-a', 'militia', ENEMY_ON_FIELD.x + 1, ENEMY_ON_FIELD.z),
        spawn('def-b', 'militia', ENEMY_ON_FIELD.x - 1, ENEMY_ON_FIELD.z),
        spawn('def-c', 'militia', ENEMY_ON_FIELD.x, ENEMY_ON_FIELD.z + 1),
      ],
      'defender',
    );
    const best = (w: World) => Math.max(0, ...arrowsOf(fireDecisions(w.ctx, w.state, unitOf(w.state, IDS.winch))).map((d) => d.score));
    expect(best(crowded)).toBeLessThan(best(alone));
  });

  it('does nothing without an action left', () => {
    const { ctx, state } = world([spawn(ATT_ARCHER, 'archer', ARCHER_AT_BRIDGE.x, ARCHER_AT_BRIDGE.z), spawn(IDS.winch, 'towerArcher', 30, 9)], 'attacker');
    const spent = withUnit(state, ATT_ARCHER, { actions: 0 });
    expect(fireDecisions(ctx, spent, unitOf(spent, ATT_ARCHER))).toEqual([]);
  });
});

describe('breachGuardValue', () => {
  const units = [spawn(DEFENDER, 'wallGuard', 28, 9), spawn(ATT_SOLDIER, 'soldier', 16, 5)];
  /** Inside the enclosure (nearer to the centre of the walls than the breach), a few metres from it. */
  const BEHIND_BREACH = pt(WALL_X + 2, 6);
  /** Outside the curtain, as close to the breach. */
  const OUTSIDE = pt(WALL_X - 2, 4);

  it('is 0 without a breach, and for an attacker', () => {
    const { ctx, state } = world(units, 'defender');
    expect(breachGuardValue(ctx, state, unitOf(state, DEFENDER), BEHIND_BREACH)).toBe(0);
    const broken = withBroken(state, IDS.wallA);
    expect(breachGuardValue(ctx, broken, unitOf(broken, ATT_SOLDIER), BEHIND_BREACH)).toBe(0);
  });

  it('is positive inside, near a fallen curtain, and shrinks with the distance to the breach', () => {
    const { ctx, state } = world(units, 'defender');
    const broken = withBroken(state, IDS.wallA);
    const guard = unitOf(broken, DEFENDER);
    const near = breachGuardValue(ctx, broken, guard, BEHIND_BREACH);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThanOrEqual(W.breachGuard);
    const farther = breachGuardValue(ctx, broken, guard, pt(WALL_X + 2, 8));
    expect(farther).toBeGreaterThan(0);
    expect(farther).toBeLessThan(near);
  });

  it('is 0 outside the walls, and far from the breach', () => {
    const { ctx, state } = world(units, 'defender');
    const broken = withBroken(state, IDS.wallA);
    const guard = unitOf(broken, DEFENDER);
    expect(breachGuardValue(ctx, broken, guard, OUTSIDE)).toBe(0);
    expect(breachGuardValue(ctx, broken, guard, pt(60, 15))).toBe(0);
  });
});

describe('sallyTarget', () => {
  const sally = (extra: UnitSpawn[]): World => world([spawn(DEFENDER, 'wallGuard', 28, 9), spawn(IDS.ram, 'ram', 19, 9), ...extra], 'defender');

  it('returns the enemy engine left without escort within sallyRadiusM', () => {
    const { ctx, state } = sally([]);
    expect(sallyTarget(ctx, state, unitOf(state, DEFENDER))?.id).toBe(IDS.ram);
  });

  it('an engine alone still draws a sally when other engines are around (they do not escort)', () => {
    const { ctx, state } = sally([spawn(IDS.catapult, 'catapult', 17, 9)]);
    expect(sallyTarget(ctx, state, unitOf(state, DEFENDER))?.id).toBeDefined();
  });

  it('is null when an attacking footman stands within isolationM of the engine, and back once he is farther', () => {
    const escorted = sally([spawn(ATT_SOLDIER, 'soldier', 19 - Math.floor(W.isolationM), 9)]);
    expect(sallyTarget(escorted.ctx, escorted.state, unitOf(escorted.state, DEFENDER))).toBeNull();
    const released = sally([spawn(ATT_SOLDIER, 'soldier', 19 - Math.ceil(W.isolationM) - 2, 9)]);
    expect(sallyTarget(released.ctx, released.state, unitOf(released.state, DEFENDER))?.id).toBe(IDS.ram);
  });

  it('is null when the engine is farther than sallyRadiusM', () => {
    const w = world([spawn(DEFENDER, 'wallGuard', 28, 9), spawn(IDS.ram, 'ram', 1, 9)], 'defender');
    const far = withUnit(w.state, IDS.ram, { position: pt(1, 9) });
    const farGuard = withUnit(far, DEFENDER, { position: pt(1 + Math.ceil(W.sallyRadiusM) + 1, 9) });
    expect(sallyTarget(w.ctx, farGuard, unitOf(farGuard, DEFENDER))).toBeNull();
  });

  it('is null for an attacker, and for a defender with no engine to hit', () => {
    const { ctx, state } = sally([spawn(ATT_SOLDIER, 'soldier', 5, 5)]);
    expect(sallyTarget(ctx, state, unitOf(state, ATT_SOLDIER))).toBeNull();
    const dead = withUnit(state, IDS.ram, { alive: false, hp: 0 });
    expect(sallyTarget(ctx, dead, unitOf(dead, DEFENDER))).toBeNull();
  });
});

describe('objectives', () => {
  const GATE_APPROACH_X = 8;
  const ROW = 5;
  const SAPPER = 'att-sap';
  const TOWER = 'att-tower';
  const DEFENDERS = (): UnitSpawn[] => [spawn(IDS.winch, 'towerArcher', 30, 9), spawn(IDS.far, 'militia', 60, 15)];

  it('a ram stays put while the raised drawbridge keeps the gate out of reach', () => {
    const { ctx, state } = world([spawn(IDS.ram, 'ram', GATE_APPROACH_X, 9), ...DEFENDERS()], 'attacker');
    syncNav(ctx, state.structures, state.works);
    expect(decideUnit(ctx, state, unitOf(state, IDS.ram))).toEqual([]);
  });

  it('the same ram advances towards the gate once the drawbridge is down', () => {
    const { ctx, state } = world([spawn(IDS.ram, 'ram', GATE_APPROACH_X, 9), ...DEFENDERS()], 'attacker');
    const down = withBroken(state, IDS.bridge);
    syncNav(ctx, down.structures, down.works);
    const commands = decideUnit(ctx, down, unitOf(down, IDS.ram));
    expect(commands[0]?.type).toBe('move');
    const to = (commands[0] as Extract<Command, { type: 'move' }>).to;
    expect(to.x).toBeGreaterThan(GATE_APPROACH_X + 0.5);
    expect(applyCommand(ctx, down, commands[0] as Command).rejection).toBeNull();
  });

  /** The synthetic castle with its moat declared as a loop, deep enough to count as moat. */
  function moatWorld(units: UnitSpawn[]): World {
    const ditchDepthM = -1;
    const loopFarM = 500;
    const cx = (MOAT_X0 + MOAT_X1 + 1) / 2;
    const moat: MoatInfo = {
      id: 'moat-test',
      centerline: [
        { x: cx, z: -2 },
        { x: cx, z: MAP_D + 2 },
        { x: -loopFarM, z: MAP_D + 2 },
        { x: -loopFarM, z: -2 },
        { x: cx, z: -2 },
      ],
      widthM: MOAT_X1 - MOAT_X0 + 1,
      sillM: 0,
    };
    const f = buildFixture(DEFAULT_RULES, units);
    const t = createTerrainData(MAP_W, MAP_D, 1);
    t.layers.set(f.ctx.baseTerrain.layers);
    t.heights.fill(0);
    for (let iz = 0; iz <= MAP_D; iz++) for (let ix = MOAT_X0; ix <= MOAT_X1 + 1; ix++) setHeightAtCorner(t, ix, iz, ditchDepthM);
    const ctx = createBattleContext(t, DEFAULT_RULES, f.ctx.baseDeck, f.defs, [moat]);
    return { ctx, state: createBattle(ctx, SEED, f.scenario) };
  }

  it('a sapper beside a causeway wanted in front of a breach lays fascines (fillMoat)', () => {
    const { ctx, state } = moatWorld([spawn(SAPPER, 'sapper', MOAT_X1 + 1, ROW), ...DEFENDERS()]);
    // No breach, no tower waiting: no causeway is wanted yet.
    expect(worthyFillSites(ctx, state)).toEqual([]);
    const breached = withBroken(state, IDS.wallA);
    syncNav(ctx, breached.structures, breached.works);
    const wanted = worthyFillSites(ctx, breached);
    expect(wanted.length).toBeGreaterThan(0);
    expect(wanted.map((s) => s.id)).toContain(fillSiteId('moat-test', 1));
    const commands = decideUnit(ctx, breached, unitOf(breached, SAPPER));
    expect(commands).toHaveLength(1);
    expect(commands[0]?.type).toBe('fillMoat');
    expect(applyCommand(ctx, breached, commands[0] as Command).rejection).toBeNull();
  });

  it('once a causeway is done in front of the breach, no other is wanted and the sapper stops filling', () => {
    const { ctx, state } = moatWorld([spawn(SAPPER, 'sapper', MOAT_X1 + 1, ROW), ...DEFENDERS()]);
    const done: BattleState = { ...withBroken(state, IDS.wallA), works: [{ id: fillSiteId('moat-test', 1), progress: DEFAULT_RULES.structures.fillTurns, done: true }] };
    syncNav(ctx, done.structures, done.works);
    expect(worthyFillSites(ctx, done)).toEqual([]);
    const commands = decideUnit(ctx, done, unitOf(done, SAPPER));
    expect(commands.some((c) => c.type === 'fillMoat')).toBe(false);
  });

  it('a siege tower within reach of an intact curtain docks', () => {
    const { ctx, state } = world([spawn(TOWER, 'siegeTower', WALL_X - 1, 4), ...DEFENDERS()], 'attacker');
    const commands = decideUnit(ctx, state, unitOf(state, TOWER));
    expect(commands).toEqual([{ type: 'dockTower', unitId: TOWER, structureId: IDS.wallA }]);
    expect(applyCommand(ctx, state, commands[0] as Command).rejection).toBeNull();
  });

  it('a tower facing a fallen segment cannot dock there', () => {
    const { ctx, state } = world([spawn(TOWER, 'siegeTower', WALL_X - 1, 4), ...DEFENDERS()], 'attacker');
    const breached = withBroken(state, IDS.wallA);
    syncNav(ctx, breached.structures, breached.works);
    expect(decideUnit(ctx, breached, unitOf(breached, TOWER)).some((c) => c.type === 'dockTower')).toBe(false);
  });

  it('a footman beside a docked tower climbs it', () => {
    const { ctx, state } = world([spawn(TOWER, 'siegeTower', WALL_X - 1, 4), spawn(ATT_SOLDIER, 'soldier', WALL_X - 2, 4), ...DEFENDERS()], 'attacker');
    const docked = applyCommand(ctx, state, { type: 'dockTower', unitId: TOWER, structureId: IDS.wallA }).state;
    expect(docked.docks).toHaveLength(1);
    syncNav(ctx, docked.structures, docked.works);
    const commands = decideUnit(ctx, docked, unitOf(docked, ATT_SOLDIER));
    expect(commands).toEqual([{ type: 'climbTower', unitId: ATT_SOLDIER, towerId: TOWER }]);
    expect(applyCommand(ctx, docked, commands[0] as Command).rejection).toBeNull();
  });

  it('a docked tower stays where it is', () => {
    const { ctx, state } = world([spawn(TOWER, 'siegeTower', WALL_X - 1, 4), ...DEFENDERS()], 'attacker');
    const docked = applyCommand(ctx, state, { type: 'dockTower', unitId: TOWER, structureId: IDS.wallA }).state;
    syncNav(ctx, docked.structures, docked.works);
    const next = applyCommand(ctx, applyCommand(ctx, docked, { type: 'endTurn' }).state, { type: 'endTurn' }).state;
    expect(decideUnit(ctx, next, unitOf(next, TOWER)).some((c) => c.type === 'move')).toBe(false);
  });
});

describe('stagingOrigins', () => {
  const units = [spawn(IDS.ram, 'ram', 6, 9), spawn(IDS.winch, 'towerArcher', 30, 9)];

  it('is non-empty at a raised drawbridge, and never on a deck', () => {
    const { ctx, state } = world(units, 'attacker');
    syncNav(ctx, state.structures, state.works);
    const origins = stagingOrigins(ctx, state, 'foot');
    expect(origins.length).toBeGreaterThan(0);
    for (const i of origins) expect(ctx.nav.deck[i] as number, `cell ${i}`).toBeLessThanOrEqual(0);
    // The filter is not vacuous: the gate's surroundings include wall-walk cells on a deck.
    const gate = ctx.structures.find((d) => d.id === IDS.gate);
    const unfiltered = cellsWithinReach(ctx, 'foot', gate?.cells ?? [], W.stagingOuterM, W.stagingInnerM);
    expect(unfiltered.some((i) => (ctx.nav.deck[i] as number) > 0)).toBe(true);
  });

  it('keeps the staging ring between stagingInnerM and stagingOuterM of the obstacle', () => {
    const { ctx, state } = world(units, 'attacker');
    syncNav(ctx, state.structures, state.works);
    const target = ctx.structures.filter((d) => d.gateId !== undefined);
    for (const i of stagingOrigins(ctx, state, 'foot')) {
      const p = { x: (i % MAP_W) + 0.5, z: Math.floor(i / MAP_W) + 0.5 };
      const nearest = Math.min(...target.flatMap((d) => d.cells.map((c) => Math.hypot((c % MAP_W) + 0.5 - p.x, Math.floor(c / MAP_W) + 0.5 - p.z))));
      expect(nearest).toBeLessThanOrEqual(W.stagingOuterM + 1);
    }
  });

  it('is still non-empty with the bridge down (the gate is the obstacle), and empty once the whole gatehouse is open', () => {
    const { ctx, state } = world(units, 'attacker');
    const bridgeDown = withBroken(state, IDS.bridge);
    syncNav(ctx, bridgeDown.structures, bridgeDown.works);
    const lowered = stagingOrigins(ctx, bridgeDown, 'foot');
    expect(lowered.length).toBeGreaterThan(0);
    for (const i of lowered) expect(ctx.nav.deck[i] as number).toBeLessThanOrEqual(0);
    const open = withBroken(state, IDS.bridge, IDS.gate, IDS.portcullis);
    syncNav(ctx, open.structures, open.works);
    expect(stagingOrigins(ctx, open, 'foot')).toEqual([]);
  });
});

describe('determinism', () => {
  it('playTurn of the defenders twice on the same state gives the same commands, events and hash', () => {
    const units = [
      spawn(DEFENDER, 'wallGuard', NEXT_TO_GATE.x, NEXT_TO_GATE.z),
      spawn(IDS.winch, 'towerArcher', 30, 9),
      spawn('def-mil', 'militia', 36, 5),
      spawn(ATT_SOLDIER, 'soldier', ENEMY_ON_FIELD.x, ENEMY_ON_FIELD.z),
      spawn(IDS.ram, 'ram', 19, 9),
    ];
    const { ctx, state } = world(units, 'defender');
    const lit = burning(state, idx(GATE_FIRE.x, GATE_FIRE.z));
    const a = playTurn(ctx, lit, 'defender');
    const b = playTurn(ctx, lit, 'defender');
    expect(a.commands.length).toBeGreaterThan(1);
    expect(a.commands).toEqual(b.commands);
    expect(a.events).toEqual(b.events);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    // The commands survive a JSON round trip and still replay to the same state.
    const parsed = JSON.parse(JSON.stringify(a.commands)) as Command[];
    let s = lit;
    for (const c of parsed) s = applyCommand(ctx, s, c).state;
    expect(hashBattleState(s)).toBe(hashBattleState(a.state));
  });
});
