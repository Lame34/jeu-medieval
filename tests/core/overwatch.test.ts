/**
 * Overwatch ("garde", brief §9.2): setting a cone, reaction shots fired mid-move, threat
 * exposure, and expiration at the start of the watcher's own next turn.
 */
import { describe, expect, it } from 'vitest';
import {
  TerrainLayer,
  applyCommand,
  canOverwatch,
  createBattle,
  createBattleContext,
  findUnit,
  hashBattleState,
  hashValue,
  moveThroughOverwatch,
  planMove,
  replay,
  shotOddsAt,
  threatsAt,
  vec2,
  type BattleState,
  type Command,
  type MovePlan,
  type Scenario,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, fillRect, flatTerrain, rulesWithDamageOverrides, SEEDS } from './helpers.ts';

const SEED = SEEDS.overwatch;
const RULES = DEFAULT_RULES;
const D = RULES.damage;

function makeCtx(width = 20, depth = 5, rules = RULES) {
  return createBattleContext(flatTerrain(width, depth, 1), rules);
}

function plannedMove(ctx: ReturnType<typeof makeCtx>, state: BattleState, unitId: string, to: ReturnType<typeof vec2>): MovePlan {
  const result = planMove(ctx, state, unitId, to);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.plan;
}

// ---------------------------------------------------------------------------------------------
// canOverwatch
// ---------------------------------------------------------------------------------------------

describe('canOverwatch', () => {
  const ctx = makeCtx();

  it('is true for a direct-fire ranged unit (archer)', () => {
    const state = createBattle(ctx, SEED, { units: [{ id: 'a', typeKey: 'archer', position: centerOf(1, 1) }] });
    expect(canOverwatch(ctx, findUnit(state, 'a')!)).toBe(true);
  });

  it('is false for a melee unit (soldier)', () => {
    const state = createBattle(ctx, SEED, { units: [{ id: 'a', typeKey: 'soldier', position: centerOf(1, 1) }] });
    expect(canOverwatch(ctx, findUnit(state, 'a')!)).toBe(false);
  });

  it('is false for an indirect-fire unit (catapult)', () => {
    const state = createBattle(ctx, SEED, { units: [{ id: 'a', typeKey: 'catapult', position: centerOf(1, 1) }] });
    expect(canOverwatch(ctx, findUnit(state, 'a')!)).toBe(false);
  });

  it('is false for a unit with no attack at all (siegeTower)', () => {
    const state = createBattle(ctx, SEED, { units: [{ id: 'a', typeKey: 'siegeTower', position: centerOf(1, 1) }] });
    expect(canOverwatch(ctx, findUnit(state, 'a')!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// applyCommand: overwatch — rejections and the happy path
// ---------------------------------------------------------------------------------------------

describe('applyCommand: overwatch', () => {
  function scenario(): Scenario {
    return {
      units: [
        { id: 'archer', typeKey: 'archer', position: centerOf(1, 1) },
        { id: 'soldier', typeKey: 'soldier', position: centerOf(1, 2) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(15, 1) },
      ],
    };
  }

  it('unknownUnit', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    const command: Command = { type: 'overwatch', unitId: 'ghost', direction: vec2(1, 0) };
    expect(applyCommand(ctx, state, command).rejection).toBe('unknownUnit');
  });

  it('unitDead', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    const dead: BattleState = { ...state, units: state.units.map((u) => (u.id === 'archer' ? { ...u, alive: false } : u)) };
    expect(applyCommand(ctx, dead, { type: 'overwatch', unitId: 'archer', direction: vec2(1, 0) }).rejection).toBe('unitDead');
  });

  it('notYourTurn', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    expect(applyCommand(ctx, state, { type: 'overwatch', unitId: 'def', direction: vec2(1, 0) }).rejection).toBe('notYourTurn');
  });

  it('unitFleeing', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    const fleeing: BattleState = { ...state, units: state.units.map((u) => (u.id === 'archer' ? { ...u, morale: RULES.morale.fleeBelow - 1 } : u)) };
    expect(applyCommand(ctx, fleeing, { type: 'overwatch', unitId: 'archer', direction: vec2(1, 0) }).rejection).toBe('unitFleeing');
  });

  it('cannotOverwatch: a melee unit cannot watch a cone', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    expect(applyCommand(ctx, state, { type: 'overwatch', unitId: 'soldier', direction: vec2(1, 0) }).rejection).toBe('cannotOverwatch');
  });

  it('noActionLeft', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    const spent: BattleState = { ...state, units: state.units.map((u) => (u.id === 'archer' ? { ...u, actions: 0 } : u)) };
    expect(applyCommand(ctx, spent, { type: 'overwatch', unitId: 'archer', direction: vec2(1, 0) }).rejection).toBe('noActionLeft');
  });

  it('insufficientAp', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    const starved: BattleState = { ...state, units: state.units.map((u) => (u.id === 'archer' ? { ...u, ap: D.attackApCost - 0.5 } : u)) };
    expect(applyCommand(ctx, starved, { type: 'overwatch', unitId: 'archer', direction: vec2(1, 0) }).rejection).toBe('insufficientAp');
  });

  it('invalidDirection: the zero vector is not a direction', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    expect(applyCommand(ctx, state, { type: 'overwatch', unitId: 'archer', direction: vec2(0, 0) }).rejection).toBe('invalidDirection');
  });

  it('on success: sets overwatch and facing to the normalised direction, spends AP and the action', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario());
    const command: Command = { type: 'overwatch', unitId: 'archer', direction: vec2(3, 4) }; // not unit length
    const result = applyCommand(ctx, state, command);
    expect(result.rejection).toBeNull();
    const archer = findUnit(result.state, 'archer')!;
    expect(archer.overwatch).toEqual(vec2(0.6, 0.8));
    expect(archer.facing).toEqual(vec2(0.6, 0.8));
    expect(archer.ap).toBe(0);
    expect(archer.actions).toBe(0);
    expect(result.events).toEqual([{ type: 'overwatchSet', unitId: 'archer', direction: vec2(0.6, 0.8) }]);
  });
});

// ---------------------------------------------------------------------------------------------
// shotOddsAt / threatsAt
// ---------------------------------------------------------------------------------------------

describe('shotOddsAt', () => {
  it('returns null when the point is out of the shooter’s range', () => {
    const archerRangeM = RULES.units['archer']!.attack!.rangeM;
    const farCx = archerRangeM + 10;
    const ctx = makeCtx(farCx + 5, 3);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'a', typeKey: 'archer', position: centerOf(0, 1) },
        { id: 't', typeKey: 'wallGuard', position: centerOf(farCx, 1) },
      ],
    });
    const shooter = findUnit(state, 'a')!;
    const target = findUnit(state, 't')!;
    expect(shotOddsAt(ctx, shooter, target, target.position, 1)).toBeNull();
  });

  it('returns null when a wall blocks the line of sight', () => {
    const terrain = flatTerrain(10, 3, 1);
    fillRect(terrain, 4, 1, 5, 1, TerrainLayer.Wall);
    const ctx = createBattleContext(terrain, RULES);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'a', typeKey: 'archer', position: centerOf(0, 1) },
        { id: 't', typeKey: 'wallGuard', position: centerOf(9, 1) },
      ],
    });
    const shooter = findUnit(state, 'a')!;
    const target = findUnit(state, 't')!;
    expect(shotOddsAt(ctx, shooter, target, centerOf(9, 1), 1)).toBeNull();
  });

  it('otherwise returns the same odds as blowOdds for that geometry', () => {
    const ctx = makeCtx(20, 3);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'a', typeKey: 'archer', position: centerOf(0, 1) },
        { id: 't', typeKey: 'wallGuard', position: centerOf(9, 1) },
      ],
    });
    const shooter = findUnit(state, 'a')!;
    const target = findUnit(state, 't')!;
    const odds = shotOddsAt(ctx, shooter, target, target.position, 1);
    expect(odds).not.toBeNull();
    expect(odds!.hitChance).toBeCloseTo(RULES.units['archer']!.attack!.accuracy, 10); // flat, no cover, no height
  });
});

describe('threatsAt', () => {
  it('lists only living enemies that could hit the position, not allies or the out-of-range', () => {
    // "mover"/"ally" are attacker-side (soldier/archer); "*-enemy" are defender-side (crossbowman).
    const crossbowRangeM = RULES.units['crossbowman']!.attack!.rangeM;
    const ctx = makeCtx(Math.ceil(crossbowRangeM) + 20, 3);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'mover', typeKey: 'soldier', position: centerOf(0, 1) },
        { id: 'ally', typeKey: 'archer', position: centerOf(0, 2), facing: vec2(1, 0) },
        { id: 'near-enemy', typeKey: 'crossbowman', position: centerOf(5, 1), facing: vec2(-1, 0) },
        { id: 'far-enemy', typeKey: 'crossbowman', position: centerOf(crossbowRangeM + 15, 1), facing: vec2(-1, 0) },
        { id: 'dead-enemy', typeKey: 'crossbowman', position: centerOf(6, 1), facing: vec2(-1, 0) },
      ],
    });
    const withDeadEnemy: BattleState = { ...state, units: state.units.map((u) => (u.id === 'dead-enemy' ? { ...u, alive: false } : u)) };
    const mover = findUnit(withDeadEnemy, 'mover')!;
    const threats = threatsAt(ctx, withDeadEnemy, mover, centerOf(0, 1));
    const ids = threats.map((t) => t.enemyId).sort();
    expect(ids).toEqual(['near-enemy']);
  });
});

// ---------------------------------------------------------------------------------------------
// moveThroughOverwatch
// ---------------------------------------------------------------------------------------------

describe('moveThroughOverwatch: no watchers', () => {
  it('behaves like a plain move: one unitMoved event, the RNG stream is not touched', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, { units: [{ id: 'mover', typeKey: 'soldier', position: centerOf(0, 1) }] });
    const mover = findUnit(state, 'mover')!;
    const plan = plannedMove(ctx, state, 'mover', centerOf(5, 1));
    const { state: after, events } = moveThroughOverwatch(ctx, state, mover, plan);
    expect(events).toEqual([{ type: 'unitMoved', unitId: 'mover', path: plan.path, apCost: plan.apCost, apSpent: plan.apSpent }]);
    expect(after.rng).toEqual(state.rng);
    expect(findUnit(after, 'mover')!.position).toEqual(plan.destination);
  });
});

describe('moveThroughOverwatch: reaction shots', () => {
  function overwatchScenario(watcherDirection: ReturnType<typeof vec2>): { ctx: ReturnType<typeof makeCtx>; state: BattleState } {
    const ctx = makeCtx(20, 5);
    const base = createBattle(ctx, SEED, {
      units: [
        { id: 'watcher', typeKey: 'crossbowman', position: centerOf(10, 2) },
        { id: 'mover', typeKey: 'soldier', position: centerOf(0, 2) },
      ],
      firstFaction: 'defender', // so the watcher (defender) can set overwatch first
    });
    const withDirection: BattleState = { ...base, units: base.units.map((u) => (u.id === 'watcher' ? { ...u, overwatch: watcherDirection } : u)) };
    return { ctx, state: withDirection };
  }

  it('fires exactly one reaction shot when the mover enters the cone, in range and in sight', () => {
    const { ctx, state } = overwatchScenario(vec2(-1, 0)); // facing towards the mover's approach
    const afterEndTurn = applyCommand(ctx, state, { type: 'endTurn' }); // hand the turn to the mover's faction
    const active = afterEndTurn.state;
    const mover = findUnit(active, 'mover')!;
    const plan = plannedMove(ctx, active, 'mover', centerOf(9, 2)); // walks straight into the watcher's cone/range
    const { state: after, events } = moveThroughOverwatch(ctx, active, mover, plan);
    const reactions = events.filter((e) => e.type === 'unitAttacked' && e.reaction === true);
    expect(reactions).toHaveLength(1);
    expect(findUnit(after, 'watcher')!.overwatch).toBeNull(); // consumed
    // The move is cut into segments that reconnect end-to-end.
    const moves = events.filter((e) => e.type === 'unitMoved');
    expect(moves.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < moves.length; i++) {
      const prevPath = (moves[i - 1] as { path: readonly { x: number; z: number }[] }).path;
      const curPath = (moves[i] as { path: readonly { x: number; z: number }[] }).path;
      expect(curPath[0]).toEqual(prevPath[prevPath.length - 1]);
    }
    const lastPath = (moves[moves.length - 1] as { path: readonly { x: number; z: number }[] }).path;
    if (findUnit(after, 'mover')!.alive) expect(lastPath[lastPath.length - 1]).toEqual(plan.destination);
  });

  it('does not fire when the mover stays outside the cone', () => {
    const { ctx, state } = overwatchScenario(vec2(0, 1)); // watching south; the mover approaches from the west
    const afterEndTurn = applyCommand(ctx, state, { type: 'endTurn' });
    const active = afterEndTurn.state;
    const mover = findUnit(active, 'mover')!;
    const plan = plannedMove(ctx, active, 'mover', centerOf(9, 2));
    const { state: after, events } = moveThroughOverwatch(ctx, active, mover, plan);
    expect(events.some((e) => e.type === 'unitAttacked')).toBe(false);
    expect(events).toEqual([{ type: 'unitMoved', unitId: 'mover', path: plan.path, apCost: plan.apCost, apSpent: plan.apSpent }]);
    expect(findUnit(after, 'watcher')!.overwatch).toEqual(vec2(0, 1)); // unconsumed
  });

  it('does not fire when the mover never comes within the watcher’s range', () => {
    const crossbowRangeM = RULES.units['crossbowman']!.attack!.rangeM;
    const ctx = makeCtx(Math.ceil(crossbowRangeM) + 30, 5);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'watcher', typeKey: 'crossbowman', position: centerOf(0, 2) },
        { id: 'mover', typeKey: 'soldier', position: centerOf(Math.ceil(crossbowRangeM) + 20, 2) },
      ],
      firstFaction: 'defender',
    });
    const withDirection: BattleState = { ...state, units: state.units.map((u) => (u.id === 'watcher' ? { ...u, overwatch: vec2(1, 0) } : u)) };
    const afterEndTurn = applyCommand(ctx, withDirection, { type: 'endTurn' });
    const active = afterEndTurn.state;
    const mover = findUnit(active, 'mover')!;
    // The mover shuffles a few cells, staying well outside the watcher's range throughout.
    const plan = plannedMove(ctx, active, 'mover', centerOf(Math.ceil(crossbowRangeM) + 25, 2));
    const { events } = moveThroughOverwatch(ctx, active, mover, plan);
    expect(events.some((e) => e.type === 'unitAttacked')).toBe(false);
  });

  it('does not fire when a wall blocks the line of sight to the sampled point', () => {
    const terrain = flatTerrain(20, 5, 1);
    // Two cells thick: a single exact cell width leaves lineOfSight's accumulated obscurance a
    // hair under 1 by floating-point rounding (see the bug noted in the test-engineer report).
    fillRect(terrain, 4, 0, 5, 4, TerrainLayer.Wall); // a full-width wall between watcher and mover's path
    const ctx = createBattleContext(terrain, RULES);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'watcher', typeKey: 'crossbowman', position: centerOf(10, 2) },
        { id: 'mover', typeKey: 'soldier', position: centerOf(0, 2) },
      ],
      firstFaction: 'defender',
    });
    const withDirection: BattleState = { ...state, units: state.units.map((u) => (u.id === 'watcher' ? { ...u, overwatch: vec2(-1, 0) } : u)) };
    const afterEndTurn = applyCommand(ctx, withDirection, { type: 'endTurn' });
    const active = afterEndTurn.state;
    const mover = findUnit(active, 'mover')!;
    const plan = plannedMove(ctx, active, 'mover', centerOf(3, 2)); // stays on the near side of the wall
    const { events } = moveThroughOverwatch(ctx, active, mover, plan);
    expect(events.some((e) => e.type === 'unitAttacked')).toBe(false);
  });

  it('a lethal reaction shot stops the mover in its tracks and can end the battle', () => {
    const rules = rulesWithDamageOverrides({ hitChanceMin: 1, hitChanceMax: 1, critChance: 1 });
    const ctx = makeCtx(20, 5, rules);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'watcher', typeKey: 'crossbowman', position: centerOf(10, 2) },
        { id: 'mover', typeKey: 'soldier', position: centerOf(0, 2) },
      ],
      firstFaction: 'defender',
    });
    const lowHp: BattleState = { ...state, units: state.units.map((u) => (u.id === 'mover' ? { ...u, hp: 1 } : u.id === 'watcher' ? { ...u, overwatch: vec2(-1, 0) } : u)) };
    const afterEndTurn = applyCommand(ctx, lowHp, { type: 'endTurn' });
    const active = afterEndTurn.state;
    const mover = findUnit(active, 'mover')!;
    const plan = plannedMove(ctx, active, 'mover', centerOf(9, 2));
    const { state: after, events } = moveThroughOverwatch(ctx, active, mover, plan);
    expect(events.filter((e) => e.type === 'unitDied')).toEqual([{ type: 'unitDied', unitId: 'mover', byId: 'watcher' }]);
    expect(findUnit(after, 'mover')!.alive).toBe(false);
    expect(after.status).toBe('defenderWon'); // "mover" (attacker) was the only attacker unit
    expect(events.filter((e) => e.type === 'battleEnded')).toEqual([{ type: 'battleEnded', status: 'defenderWon', reason: 'eliminated' }]);
    // The mover never reaches the planned destination: it stops where the shot landed.
    expect(findUnit(after, 'mover')!.position).not.toEqual(plan.destination);
  });
});

describe('overwatch: expiration', () => {
  it('expires at the start of the watcher’s own next turn, even if it never fired', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'atk', typeKey: 'archer', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(15, 1) },
      ],
    });
    const set = applyCommand(ctx, state, { type: 'overwatch', unitId: 'atk', direction: vec2(1, 0) });
    expect(set.rejection).toBeNull();
    expect(findUnit(set.state, 'atk')!.overwatch).not.toBeNull();
    const afterDefTurn = applyCommand(ctx, set.state, { type: 'endTurn' }); // defender's turn: overwatch survives
    expect(findUnit(afterDefTurn.state, 'atk')!.overwatch).not.toBeNull();
    const afterAtkTurn = applyCommand(ctx, afterDefTurn.state, { type: 'endTurn' }); // back to attacker: expires
    expect(findUnit(afterAtkTurn.state, 'atk')!.overwatch).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------------------------

describe('overwatch determinism', () => {
  function scenario(): Scenario {
    return {
      units: [
        { id: 'watcher', typeKey: 'crossbowman', position: centerOf(10, 2) },
        { id: 'mover', typeKey: 'soldier', position: centerOf(0, 2) },
      ],
      firstFaction: 'defender',
    };
  }

  function commands(): Command[] {
    return [
      { type: 'overwatch', unitId: 'watcher', direction: vec2(-1, 0) },
      { type: 'endTurn' },
      { type: 'move', unitId: 'mover', to: centerOf(9, 2) },
      { type: 'endTurn' },
      { type: 'overwatch', unitId: 'watcher', direction: vec2(-1, 0) },
    ];
  }

  it('replaying the same seed + scenario + commands twice yields the same hash and events', () => {
    const a = replay(makeCtx(20, 5), SEED, scenario(), commands());
    const b = replay(makeCtx(20, 5), SEED, scenario(), commands());
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    expect(hashValue(a.events)).toBe(hashValue(b.events));
  });

  it('a JSON round trip of the commands (including "overwatch") replays to the same hash', () => {
    const original = replay(makeCtx(20, 5), SEED, scenario(), commands());
    const roundTripped = JSON.parse(JSON.stringify(commands())) as Command[];
    const afterRoundTrip = replay(makeCtx(20, 5), SEED, scenario(), roundTripped);
    expect(hashBattleState(afterRoundTrip.state)).toBe(hashBattleState(original.state));
  });
});
