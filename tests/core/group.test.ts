/**
 * Orders for several men at once (src/core/battle/group.ts): a walk in rank, a blow by all who
 * can reach the enemy; every order accepted when given in turn, none on another man's spot.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle, createBattleContext, distance, type BattleContext, type BattleState, type Command, type Scenario } from '@core/index.ts';
import { FORMATION_SPREAD_M, planGroupMove, planGroupStrike } from '@core/battle/group.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, flatTerrain } from './helpers.ts';

/** A place may be shifted to a free cell this far from its rank slot (group.ts SLOT_SEARCH_M). */
const SLOT_SEARCH_M = 3;

function battle(units: Scenario['units']) {
  const ctx = createBattleContext(flatTerrain(64, 24, 1), DEFAULT_RULES);
  return { ctx, state: createBattle(ctx, 'group-test', { units }) };
}

/** Every man's orders, played in turn on the real battle: all accepted. */
function play(ctx: BattleContext, state: BattleState, orders: readonly (readonly Command[])[]): BattleState {
  let s = state;
  for (const man of orders) {
    for (const c of man) {
      const r = applyCommand(ctx, s, c);
      expect(r.rejection, `${c.type} ${'unitId' in c ? c.unitId : ''}`).toBeNull();
      s = r.state;
    }
  }
  return s;
}

const at = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!.position;

describe('planGroupMove', () => {
  const men = ['a', 'b', 'c'];
  const { ctx, state } = battle([
    { id: 'a', typeKey: 'soldier', position: centerOf(4, 8) },
    { id: 'b', typeKey: 'soldier', position: centerOf(4, 10) },
    { id: 'c', typeKey: 'soldier', position: centerOf(4, 12) },
    { id: 'def', typeKey: 'militia', position: centerOf(60, 20) },
  ]);

  it('walks them all, in rank, each to his own place', () => {
    const plan = planGroupMove(ctx, state, men, centerOf(12, 10));
    expect(plan.arrive).toBe(3);
    const after = play(ctx, state, plan.orders);
    const ends = men.map((id) => at(after, id));
    expect(new Set(ends.map((p) => `${p.x},${p.z}`)).size).toBe(3);
    // The rank keeps its order: a above b above c.
    expect(ends[0]!.z).toBeLessThan(ends[1]!.z);
    expect(ends[1]!.z).toBeLessThan(ends[2]!.z);
  });

  it('draws in men spread far apart, and stops those too far for this turn on the way', () => {
    const wide = battle([
      { id: 'a', typeKey: 'soldier', position: centerOf(4, 1) },
      { id: 'b', typeKey: 'soldier', position: centerOf(4, 22) },
      { id: 'def', typeKey: 'militia', position: centerOf(60, 20) },
    ]);
    const near = planGroupMove(wide.ctx, wide.state, ['a', 'b'], centerOf(8, 11));
    const after = play(wide.ctx, wide.state, near.orders);
    for (const id of ['a', 'b']) expect(distance(at(after, id), centerOf(8, 11))).toBeLessThanOrEqual(FORMATION_SPREAD_M + SLOT_SEARCH_M + 1);
    const far = planGroupMove(wide.ctx, wide.state, ['a', 'b'], centerOf(58, 11));
    expect(far.partial).toBe(2);
    play(wide.ctx, wide.state, far.orders);
  });

  it('a man without points of action stays put', () => {
    const tired = { ...state, units: state.units.map((u) => (u.id === 'b' ? { ...u, ap: 0 } : u)) };
    const plan = planGroupMove(ctx, tired, men, centerOf(12, 10));
    expect(plan.idle).toBe(1);
    play(ctx, tired, plan.orders);
  });
});

describe('planGroupStrike', () => {
  it('those who can reach the enemy this turn strike him, the others close in', () => {
    const { ctx, state } = battle([
      { id: 'a', typeKey: 'soldier', position: centerOf(10, 9) },
      { id: 'b', typeKey: 'soldier', position: centerOf(10, 11) },
      { id: 'c', typeKey: 'soldier', position: centerOf(50, 10) },
      { id: 'def', typeKey: 'sallyKnight', position: centerOf(13, 10) },
    ]);
    const plan = planGroupStrike(ctx, state, ['a', 'b', 'c'], 'def');
    expect(plan.strikes).toBe(2);
    expect(plan.closeIn).toBe(1);
    const blows = plan.orders.flat().filter((c) => c.type === 'attack');
    expect(blows).toHaveLength(2);
    play(ctx, state, plan.orders);
  });
});
