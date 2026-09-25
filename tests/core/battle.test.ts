import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MORALE,
  ScenarioError,
  TerrainLayer,
  apSpentFor,
  applyCommand,
  createBattle,
  createBattleContext,
  findUnit,
  movementArea,
  planMove,
  vec2,
  type BattleContext,
  type BattleState,
  type Scenario,
  type UnitSpawn,
  type Vec2,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { fillRect, flatTerrain } from './helpers.ts';

/** Centre of cell (cx, cz) on a cellSize=1 map, matching how createBattle snaps spawns. */
function centerOf(cx: number, cz: number): Vec2 {
  return vec2(cx + 0.5, cz + 0.5);
}

function makeContext(size = 10): BattleContext {
  return createBattleContext(flatTerrain(size, size, 1), DEFAULT_RULES);
}

const SEED = 'battle-tests';

describe('createBattle', () => {
  it('rejects a scenario with a duplicate unit id', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'dup', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'dup', typeKey: 'soldier', position: centerOf(2, 2) },
      ],
    };
    expect(() => createBattle(ctx, SEED, scenario)).toThrow(ScenarioError);
  });

  it('rejects a scenario with an unknown unit type', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'dragon', position: centerOf(1, 1) }] };
    expect(() => createBattle(ctx, SEED, scenario)).toThrow(ScenarioError);
  });

  it('rejects spawning on an impassable cell', () => {
    const t = flatTerrain(5, 5, 1);
    fillRect(t, 2, 2, 2, 2, TerrainLayer.Wall);
    const ctx = createBattleContext(t, DEFAULT_RULES);
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(2, 2) }] };
    expect(() => createBattle(ctx, SEED, scenario)).toThrow(ScenarioError);
  });

  it('rejects spawning two units on the same cell', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'u1', typeKey: 'soldier', position: centerOf(3, 3) },
        { id: 'u2', typeKey: 'crossbowman', position: centerOf(3, 3) },
      ],
    };
    expect(() => createBattle(ctx, SEED, scenario)).toThrow(ScenarioError);
  });

  it('sorts units by id regardless of scenario order', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'zebra', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'alpha', typeKey: 'crossbowman', position: centerOf(2, 2) },
        { id: 'mike', typeKey: 'archer', position: centerOf(3, 3) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(state.units.map((u) => u.id)).toEqual(['alpha', 'mike', 'zebra']);
  });

  it('gives full AP to the starting faction and 0 AP to the other, and sets initial morale', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 8) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario); // default firstFaction: 'attacker'
    const atk = findUnit(state, 'atk');
    const def = findUnit(state, 'def');
    expect(atk?.ap).toBe(DEFAULT_RULES.units['soldier']?.ap);
    expect(def?.ap).toBe(0);
    expect(atk?.morale).toBe(DEFAULT_MORALE);
    expect(atk?.alive).toBe(true);
    expect(atk?.hp).toBe(DEFAULT_RULES.units['soldier']?.hp);
  });

  it('honours an explicit firstFaction: defender starts with full AP instead', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 8) },
      ],
      firstFaction: 'defender',
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(findUnit(state, 'atk')?.ap).toBe(0);
    expect(findUnit(state, 'def')?.ap).toBe(DEFAULT_RULES.units['wallGuard']?.ap);
    expect(state.activeFaction).toBe('defender');
  });

  it('is deterministic: same seed and scenario produce an identical initial state (module the rng field, which is derived from the seed too)', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(1, 1) }] };
    const a = createBattle(ctx, SEED, scenario);
    const b = createBattle(ctx, SEED, scenario);
    expect(a).toEqual(b);
  });
});

describe('planMove: rejection reasons', () => {
  function oneUnitScenario(unit: Partial<UnitSpawn> & { id: string; typeKey: string }): Scenario {
    return { units: [{ position: centerOf(1, 1), ...unit }] };
  }

  it('unknownUnit: the unit id does not exist', () => {
    const ctx = makeContext();
    const state = createBattle(ctx, SEED, oneUnitScenario({ id: 'u1', typeKey: 'soldier' }));
    const result = planMove(ctx, state, 'ghost', centerOf(2, 2));
    expect(result).toEqual({ ok: false, reason: 'unknownUnit' });
  });

  it('unitDead: the unit exists but is not alive', () => {
    const ctx = makeContext();
    const state = createBattle(ctx, SEED, oneUnitScenario({ id: 'u1', typeKey: 'soldier' }));
    const deadState: BattleState = { ...state, units: state.units.map((u) => (u.id === 'u1' ? { ...u, alive: false } : u)) };
    const result = planMove(ctx, deadState, 'u1', centerOf(2, 2));
    expect(result).toEqual({ ok: false, reason: 'unitDead' });
  });

  it('outOfBounds: the target lies outside the map', () => {
    const ctx = makeContext();
    const state = createBattle(ctx, SEED, oneUnitScenario({ id: 'u1', typeKey: 'soldier' }));
    expect(planMove(ctx, state, 'u1', vec2(-1, 2))).toEqual({ ok: false, reason: 'outOfBounds' });
    expect(planMove(ctx, state, 'u1', vec2(2, 999))).toEqual({ ok: false, reason: 'outOfBounds' });
  });

  it('sameCell: the target is inside the unit’s current cell', () => {
    const ctx = makeContext();
    const state = createBattle(ctx, SEED, oneUnitScenario({ id: 'u1', typeKey: 'soldier' }));
    expect(planMove(ctx, state, 'u1', vec2(1.1, 1.9))).toEqual({ ok: false, reason: 'sameCell' });
  });

  it('destinationOccupied: another living unit already stands on the target cell', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'mover', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'blocker', typeKey: 'crossbowman', position: centerOf(3, 3) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(planMove(ctx, state, 'mover', centerOf(3, 3))).toEqual({ ok: false, reason: 'destinationOccupied' });
  });

  it('noPath: the destination is fully enclosed by walls', () => {
    const t = flatTerrain(6, 6, 1);
    fillRect(t, 2, 1, 4, 1, TerrainLayer.Wall);
    fillRect(t, 2, 1, 2, 4, TerrainLayer.Wall);
    fillRect(t, 4, 1, 4, 4, TerrainLayer.Wall);
    fillRect(t, 2, 4, 4, 4, TerrainLayer.Wall);
    const ctx = createBattleContext(t, DEFAULT_RULES);
    const state = createBattle(ctx, SEED, oneUnitScenario({ id: 'u1', typeKey: 'soldier', position: centerOf(0, 0) }));
    const result = planMove(ctx, state, 'u1', centerOf(3, 2)); // inside the enclosed pocket
    expect(result).toEqual({ ok: false, reason: 'noPath' });
  });

  it('insufficientAp: a reachable destination costs more AP than the unit has', () => {
    const ctx = makeContext();
    const state = createBattle(ctx, SEED, oneUnitScenario({ id: 'u1', typeKey: 'soldier', position: centerOf(0, 0) }));
    const starved: BattleState = { ...state, units: state.units.map((u) => (u.id === 'u1' ? { ...u, ap: 0.01 } : u)) };
    const result = planMove(ctx, starved, 'u1', centerOf(9, 9)); // far away, definitely reachable unbounded
    expect(result).toEqual({ ok: false, reason: 'insufficientAp' });
  });

  it('allies are traversable but cannot be the destination; enemies block entirely', () => {
    // A single-row corridor: mover at (0,0), blocker at (1,0), free target at (2,0).
    const t = flatTerrain(3, 1, 1);
    const ctx = createBattleContext(t, DEFAULT_RULES);

    const allyScenario: Scenario = {
      units: [
        { id: 'mover', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'ally', typeKey: 'knight', position: centerOf(1, 0) },
      ],
    };
    const allyState = createBattle(ctx, SEED, allyScenario);
    const throughAlly = planMove(ctx, allyState, 'mover', centerOf(2, 0));
    expect(throughAlly.ok).toBe(true); // walks through the ally's cell
    expect(planMove(ctx, allyState, 'mover', centerOf(1, 0))).toEqual({ ok: false, reason: 'destinationOccupied' });

    const enemyScenario: Scenario = {
      units: [
        { id: 'mover', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'enemy', typeKey: 'crossbowman', position: centerOf(1, 0) },
      ],
    };
    const enemyState = createBattle(ctx, SEED, enemyScenario);
    // The 1-wide corridor means the enemy-occupied cell is the only route through: blocked entirely.
    expect(planMove(ctx, enemyState, 'mover', centerOf(2, 0))).toEqual({ ok: false, reason: 'noPath' });
  });
});

describe('planMove: happy path', () => {
  it('finds a valid plan whose apSpent is the ceiling of its apCost', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(0, 0) }] };
    const state = createBattle(ctx, SEED, scenario);
    const result = planMove(ctx, state, 'u1', centerOf(2, 0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.apSpent).toBe(apSpentFor(result.plan.apCost));
      expect(result.plan.path[0]).toEqual(centerOf(0, 0));
      expect(result.plan.path[result.plan.path.length - 1]).toEqual(centerOf(2, 0));
    }
  });
});

describe('apSpentFor', () => {
  it('is the ceiling of the AP cost, within AP_EPSILON', () => {
    expect(apSpentFor(0)).toBe(0);
    expect(apSpentFor(2)).toBe(2);
    expect(apSpentFor(2.0000001)).toBe(2); // within AP_EPSILON of 2
    expect(apSpentFor(2.5)).toBe(3);
    expect(apSpentFor(2.9999999)).toBe(3);
  });

  it('never returns a negative value', () => {
    expect(apSpentFor(-0.0000001)).toBe(0);
  });
});

describe('movementArea', () => {
  it('moveAndActBudget = ap - actionReserveAp (clamped at 0), moveOnlyBudget = ap', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(5, 5) }] };
    const state = createBattle(ctx, SEED, scenario);
    const area = movementArea(ctx, state, 'u1');
    expect(area).not.toBeNull();
    const fullAp = DEFAULT_RULES.units['soldier']?.ap as number;
    expect(area?.moveOnlyBudget).toBe(fullAp);
    expect(area?.moveAndActBudget).toBe(Math.max(0, fullAp - DEFAULT_RULES.movement.actionReserveAp));
  });

  it('clamps moveAndActBudget to 0 when AP is below the action reserve', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(5, 5) }] };
    const state = createBattle(ctx, SEED, scenario);
    const starved: BattleState = { ...state, units: state.units.map((u) => ({ ...u, ap: 0 })) };
    const area = movementArea(ctx, starved, 'u1');
    expect(area?.moveAndActBudget).toBe(0);
    expect(area?.moveOnlyBudget).toBe(0);
  });

  it('returns null for an unknown or dead unit', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(5, 5) }] };
    const state = createBattle(ctx, SEED, scenario);
    expect(movementArea(ctx, state, 'ghost')).toBeNull();
    const deadState: BattleState = { ...state, units: state.units.map((u) => ({ ...u, alive: false })) };
    expect(movementArea(ctx, deadState, 'u1')).toBeNull();
  });
});

describe('applyCommand: move', () => {
  it('deducts exactly apSpent AP, moves the unit, and updates facing towards the travel direction', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(0, 0) }] };
    const state = createBattle(ctx, SEED, scenario);
    const before = findUnit(state, 'u1');
    const startAp = before?.ap as number;
    const result = applyCommand(ctx, state, { type: 'move', unitId: 'u1', to: centerOf(4, 0) });
    expect(result.rejection).toBeNull();
    const after = findUnit(result.state, 'u1');
    expect(after?.position).toEqual(centerOf(4, 0));
    expect(after?.ap).toBeLessThan(startAp);
    // facing is a unit vector pointing generally east (+x), matching travel direction.
    const facing = after?.facing;
    expect(Math.hypot(facing?.x ?? 0, facing?.z ?? 0)).toBeCloseTo(1, 6);
    expect(facing?.x ?? 0).toBeGreaterThan(0);
    expect(result.events).toEqual([
      { type: 'unitMoved', unitId: 'u1', path: expect.any(Array), apCost: expect.any(Number), apSpent: startAp - (after?.ap ?? 0) },
    ]);
  });

  it('notYourTurn: a unit cannot move on the opposing faction’s turn', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 8) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario); // attacker's turn
    const result = applyCommand(ctx, state, { type: 'move', unitId: 'def', to: centerOf(7, 8) });
    expect(result.rejection).toBe('notYourTurn');
    expect(result.state).toBe(state); // unchanged, same reference
    expect(result.events).toEqual([{ type: 'commandRejected', command: { type: 'move', unitId: 'def', to: centerOf(7, 8) }, reason: 'notYourTurn' }]);
  });

  it('a rejected command leaves the state completely unchanged and emits commandRejected', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(0, 0) }] };
    const state = createBattle(ctx, SEED, scenario);
    const command = { type: 'move' as const, unitId: 'ghost', to: centerOf(1, 1) };
    const result = applyCommand(ctx, state, command);
    expect(result.state).toBe(state);
    expect(result.rejection).toBe('unknownUnit');
    expect(result.events).toEqual([{ type: 'commandRejected', command, reason: 'unknownUnit' }]);
  });
});

describe('applyCommand: endTurn', () => {
  it('hands the turn to the other faction without incrementing the counter (attacker -> defender)', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 8) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(state.activeFaction).toBe('attacker');
    expect(state.turn).toBe(1);
    const result = applyCommand(ctx, state, { type: 'endTurn' });
    expect(result.state.activeFaction).toBe('defender');
    expect(result.state.turn).toBe(1); // still turn 1: only the attacker completing a round bumps it
    expect(findUnit(result.state, 'def')?.ap).toBe(DEFAULT_RULES.units['wallGuard']?.ap); // AP recharged
    expect(findUnit(result.state, 'atk')?.ap).toBe(findUnit(state, 'atk')?.ap); // untouched
  });

  it('increments the turn counter when the attacker plays again (defender -> attacker)', () => {
    const ctx = makeContext();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 8) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    const afterOne = applyCommand(ctx, state, { type: 'endTurn' }).state; // -> defender, turn 1
    const afterTwo = applyCommand(ctx, afterOne, { type: 'endTurn' }).state; // -> attacker, turn 2
    expect(afterTwo.activeFaction).toBe('attacker');
    expect(afterTwo.turn).toBe(2);
    expect(findUnit(afterTwo, 'atk')?.ap).toBe(DEFAULT_RULES.units['soldier']?.ap); // recharged
    expect(afterOne.activeFaction).toBe('defender'); // sanity: intermediate state as expected
  });

  it('emits turnEnded then turnStarted, in order', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'atk', typeKey: 'soldier', position: centerOf(0, 0) }] };
    const state = createBattle(ctx, SEED, scenario);
    const result = applyCommand(ctx, state, { type: 'endTurn' });
    expect(result.events).toEqual([
      { type: 'turnEnded', faction: 'attacker', turn: 1 },
      { type: 'turnStarted', faction: 'defender', turn: 1 },
    ]);
  });
});

describe('applyCommand: battle over', () => {
  it('rejects every command with battleOver once status is no longer ongoing, leaving state unchanged', () => {
    const ctx = makeContext();
    const scenario: Scenario = { units: [{ id: 'u1', typeKey: 'soldier', position: centerOf(0, 0) }] };
    const ongoing = createBattle(ctx, SEED, scenario);
    const over: BattleState = { ...ongoing, status: 'attackerWon' };
    const moveResult = applyCommand(ctx, over, { type: 'move', unitId: 'u1', to: centerOf(1, 1) });
    expect(moveResult.rejection).toBe('battleOver');
    expect(moveResult.state).toBe(over);
    const endTurnResult = applyCommand(ctx, over, { type: 'endTurn' });
    expect(endTurnResult.rejection).toBe('battleOver');
    expect(endTurnResult.state).toBe(over);
  });
});
