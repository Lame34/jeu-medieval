/**
 * Morale (brief §9.7): standing thresholds, the consequences of a blow (wounded, ally death,
 * kill), and what happens at the start of a turn (recovery, the shaken AP penalty, and routed
 * units fleeing on their own).
 */
import { describe, expect, it } from 'vitest';
import {
  TerrainLayer,
  createBattle,
  createBattleContext,
  distance,
  findUnit,
  moraleAfterBlows,
  moraleStanding,
  startTurn,
  vec2,
  type BattleState,
  type BlowOutcome,
  type GameEvent,
  type Scenario,
  type UnitState,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, fillRect, flatTerrain, SEEDS } from './helpers.ts';

const SEED = SEEDS.morale;
const RULES = DEFAULT_RULES;
const M = RULES.morale;

function makeCtx(width = 10, depth = 10) {
  return createBattleContext(flatTerrain(width, depth, 1), RULES);
}

/** A minimally-specified UnitState for morale unit tests (position/hp rarely matter here). */
function unit(overrides: Partial<UnitState> & Pick<UnitState, 'id' | 'typeKey' | 'faction'>): UnitState {
  return {
    position: vec2(0.5, 0.5),
    facing: vec2(0, -1),
    hp: 20,
    ap: 4,
    actions: 1,
    overwatch: null,
    morale: 70,
    alive: true,
    ...overrides,
  };
}

describe('moraleStanding: thresholds', () => {
  it('is steady at and above shakenBelow', () => {
    expect(moraleStanding(M, M.shakenBelow)).toBe('steady');
    expect(moraleStanding(M, M.max)).toBe('steady');
  });

  it('is shaken strictly below shakenBelow, down to (and including) fleeBelow', () => {
    expect(moraleStanding(M, M.shakenBelow - 1)).toBe('shaken');
    expect(moraleStanding(M, M.fleeBelow)).toBe('shaken');
  });

  it('is fleeing strictly below fleeBelow, down to 0', () => {
    expect(moraleStanding(M, M.fleeBelow - 1)).toBe('fleeing');
    expect(moraleStanding(M, 0)).toBe('fleeing');
  });
});

describe('moraleAfterBlows: wounded (crossing woundedHpFraction of max HP)', () => {
  const ctx = makeCtx();

  it('loses woundedLoss morale exactly when a blow crosses the wounded threshold', () => {
    const woundedHp = RULES.units['soldier']!.hp * M.woundedHpFraction;
    const target = unit({ id: 'target', typeKey: 'soldier', faction: 'defender', morale: 70 });
    const blow: BlowOutcome = { attackerId: 'atk', targetId: 'target', hpBefore: woundedHp + 1, hpAfter: woundedHp };
    const events: GameEvent[] = [];
    const out = moraleAfterBlows(ctx, [target, unit({ id: 'atk', typeKey: 'soldier', faction: 'attacker' })], [blow], events);
    expect(out.find((u) => u.id === 'target')?.morale).toBe(70 - M.woundedLoss);
    expect(events).toEqual([{ type: 'moraleChanged', unitId: 'target', morale: 70 - M.woundedLoss, delta: -M.woundedLoss, reason: 'wounded' }]);
  });

  it('does not trigger when the blow does not cross the threshold (both sides above, or both below)', () => {
    const woundedHp = RULES.units['soldier']!.hp * M.woundedHpFraction;
    const target = unit({ id: 'target', typeKey: 'soldier', faction: 'defender', morale: 70 });
    const attacker = unit({ id: 'atk', typeKey: 'soldier', faction: 'attacker' });
    const bothAbove: BlowOutcome = { attackerId: 'atk', targetId: 'target', hpBefore: woundedHp + 5, hpAfter: woundedHp + 1 };
    const eventsAbove: GameEvent[] = [];
    expect(moraleAfterBlows(ctx, [target, attacker], [bothAbove], eventsAbove).find((u) => u.id === 'target')?.morale).toBe(70);
    expect(eventsAbove).toHaveLength(0);

    const bothBelow: BlowOutcome = { attackerId: 'atk', targetId: 'target', hpBefore: woundedHp - 1, hpAfter: woundedHp - 3 };
    const eventsBelow: GameEvent[] = [];
    expect(moraleAfterBlows(ctx, [target, attacker], [bothBelow], eventsBelow).find((u) => u.id === 'target')?.morale).toBe(70);
    expect(eventsBelow).toHaveLength(0);
  });
});

describe('moraleAfterBlows: ally death and kill gain', () => {
  const ctx = makeCtx();

  function scenario(): UnitState[] {
    return [
      unit({ id: 'target', typeKey: 'soldier', faction: 'defender', position: vec2(0.5, 0.5), hp: 0, alive: false }),
      unit({ id: 'ally-near', typeKey: 'soldier', faction: 'defender', position: vec2(0.5 + M.allyDeathRadiusM / 2, 0.5), morale: 70 }),
      unit({ id: 'ally-far', typeKey: 'soldier', faction: 'defender', position: vec2(0.5 + M.allyDeathRadiusM * 3, 0.5), morale: 70 }),
      unit({ id: 'ally-dead', typeKey: 'soldier', faction: 'defender', position: vec2(0.5 + 1, 0.5), morale: 70, alive: false }),
      unit({ id: 'enemy-near', typeKey: 'soldier', faction: 'attacker', position: vec2(0.5 + 1, 0.5), morale: 70 }),
      unit({ id: 'killer', typeKey: 'soldier', faction: 'attacker', position: vec2(20.5, 20.5), morale: 70 }),
    ];
  }

  it('costs allyDeathLoss to living allies within allyDeathRadiusM, and spares everyone else', () => {
    const blow: BlowOutcome = { attackerId: 'killer', targetId: 'target', hpBefore: 5, hpAfter: 0 };
    const events: GameEvent[] = [];
    const out = moraleAfterBlows(ctx, scenario(), [blow], events);
    expect(out.find((u) => u.id === 'ally-near')?.morale).toBe(70 - M.allyDeathLoss);
    expect(out.find((u) => u.id === 'ally-far')?.morale).toBe(70); // outside the radius
    expect(out.find((u) => u.id === 'ally-dead')?.morale).toBe(70); // already dead: unaffected
    expect(out.find((u) => u.id === 'enemy-near')?.morale).toBe(70); // enemy faction: unaffected
  });

  it('gains killGain for the killer, only when the killer is still alive', () => {
    const blow: BlowOutcome = { attackerId: 'killer', targetId: 'target', hpBefore: 5, hpAfter: 0 };
    const events: GameEvent[] = [];
    const out = moraleAfterBlows(ctx, scenario(), [blow], events);
    expect(out.find((u) => u.id === 'killer')?.morale).toBe(70 + M.killGain);
    expect(events.filter((e) => e.type === 'moraleChanged' && e.reason === 'kill')).toEqual([
      { type: 'moraleChanged', unitId: 'killer', morale: 70 + M.killGain, delta: M.killGain, reason: 'kill' },
    ]);
  });

  it('does not gain morale, and does not crash, when the killer itself is already dead', () => {
    const units = scenario().map((u) => (u.id === 'killer' ? { ...u, alive: false } : u));
    const blow: BlowOutcome = { attackerId: 'killer', targetId: 'target', hpBefore: 5, hpAfter: 0 };
    const events: GameEvent[] = [];
    expect(() => moraleAfterBlows(ctx, units, [blow], events)).not.toThrow();
    const out = moraleAfterBlows(ctx, units, [blow], events);
    expect(out.find((u) => u.id === 'killer')?.morale).toBe(70); // still dead: no gain
  });

  it('clamps to [0, max] and emits no event when the change is a no-op', () => {
    const units = scenario().map((u) => (u.id === 'ally-near' ? { ...u, morale: 0 } : u));
    const blow: BlowOutcome = { attackerId: 'killer', targetId: 'target', hpBefore: 5, hpAfter: 0 };
    const events: GameEvent[] = [];
    const out = moraleAfterBlows(ctx, units, [blow], events);
    expect(out.find((u) => u.id === 'ally-near')?.morale).toBe(0); // already floored
    expect(events.some((e) => e.type === 'moraleChanged' && e.unitId === 'ally-near')).toBe(false);
  });
});

describe('startTurn: recovery and the shaken AP penalty', () => {
  function scenario(initialMorale: number): Scenario {
    return {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(9, 9) },
      ],
      initialMorale,
    };
  }

  it('regains recoveryPerTurn morale at the start of the unit’s own turn, clamped to max', () => {
    const ctx = makeCtx();
    const belowMax = M.max - 1;
    const state = createBattle(ctx, SEED, scenario(belowMax));
    const events: GameEvent[] = [];
    const after = startTurn(ctx, { ...state, activeFaction: 'attacker' }, 'attacker', events);
    expect(findUnit(after, 'atk')!.morale).toBe(Math.min(M.max, belowMax + M.recoveryPerTurn));
    expect(events.some((e) => e.type === 'moraleChanged' && e.unitId === 'atk' && e.reason === 'recovery')).toBe(true);
  });

  it('emits no recovery event when already at max morale', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario(M.max));
    const events: GameEvent[] = [];
    startTurn(ctx, { ...state, activeFaction: 'attacker' }, 'attacker', events);
    expect(events).toHaveLength(0);
  });

  it('applies shakenApPenalty when morale, after recovery, is still below shakenBelow', () => {
    const ctx = makeCtx();
    const initialMorale = M.shakenBelow - M.recoveryPerTurn - 1; // stays just under shakenBelow after recovery
    expect(initialMorale).toBeGreaterThanOrEqual(M.fleeBelow); // sanity: shaken, not fleeing
    const state = createBattle(ctx, SEED, scenario(initialMorale));
    const events: GameEvent[] = [];
    const after = startTurn(ctx, { ...state, activeFaction: 'attacker' }, 'attacker', events);
    const fullAp = RULES.units['soldier']!.ap;
    expect(findUnit(after, 'atk')!.ap).toBe(Math.max(0, fullAp - M.shakenApPenalty));
  });

  it('applies no penalty (full AP) when morale stays steady', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario(M.max));
    const events: GameEvent[] = [];
    const after = startTurn(ctx, { ...state, activeFaction: 'attacker' }, 'attacker', events);
    expect(findUnit(after, 'atk')!.ap).toBe(RULES.units['soldier']!.ap);
  });

  it('leaves the other faction and dead units completely untouched', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario(M.max - 1));
    const events: GameEvent[] = [];
    const after = startTurn(ctx, { ...state, activeFaction: 'attacker' }, 'attacker', events);
    expect(findUnit(after, 'def')).toEqual(findUnit(state, 'def')); // untouched faction
  });

  it('clears an active overwatch at the start of the watcher’s own next turn', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, scenario(M.max));
    const guarded: BattleState = { ...state, units: state.units.map((u) => (u.id === 'atk' ? { ...u, overwatch: vec2(1, 0) } : u)) };
    const events: GameEvent[] = [];
    const after = startTurn(ctx, { ...guarded, activeFaction: 'attacker' }, 'attacker', events);
    expect(findUnit(after, 'atk')!.overwatch).toBeNull();
  });
});

describe('startTurn: fleeing', () => {
  it('runs a routed unit to the reachable cell farthest from the enemy, spending its whole turn', () => {
    const ctx = makeCtx(20, 3);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
      ],
      initialMorale: M.fleeBelow - M.recoveryPerTurn - 1, // stays below fleeBelow after recovery
    };
    const state = createBattle(ctx, SEED, scenario);
    const before = findUnit(state, 'atk')!;
    const distanceBefore = distance(before.position, findUnit(state, 'def')!.position);
    const events: GameEvent[] = [];
    const after = startTurn(ctx, { ...state, activeFaction: 'attacker' }, 'attacker', events);
    const fled = findUnit(after, 'atk')!;
    expect(fled.ap).toBe(0);
    expect(fled.actions).toBe(0);
    const distanceAfter = distance(fled.position, findUnit(after, 'def')!.position);
    expect(distanceAfter).toBeGreaterThan(distanceBefore);
    const fleeEvents = events.filter((e) => e.type === 'unitMoved' && e.fleeing === true);
    expect(fleeEvents).toHaveLength(1);
  });

  it('spends the turn (AP/actions to 0) but does not move when no reachable cell is farther away', () => {
    // A single free cell (2,2) walled in on all eight neighbours: nothing is reachable at all.
    const terrain = flatTerrain(6, 6, 1);
    fillRect(terrain, 1, 1, 3, 3, TerrainLayer.Wall);
    fillRect(terrain, 2, 2, 2, 2, TerrainLayer.Plain); // carve the lone free cell back out
    const ctx = createBattleContext(terrain, RULES);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(2, 2) }, // boxed in on every side
        { id: 'def', typeKey: 'wallGuard', position: centerOf(5, 5) }, // outside the box
      ],
      initialMorale: M.fleeBelow - M.recoveryPerTurn - 1,
    };
    const state = createBattle(ctx, SEED, scenario);
    const events: GameEvent[] = [];
    const after = startTurn(ctx, { ...state, activeFaction: 'attacker' }, 'attacker', events);
    const trapped = findUnit(after, 'atk')!;
    expect(trapped.ap).toBe(0);
    expect(trapped.actions).toBe(0);
    expect(events.some((e) => e.type === 'unitMoved')).toBe(false);
  });
});
