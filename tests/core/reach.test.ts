/**
 * Doing what the player asked from where it can be done (J7, ADR-039): an attack, an engine's
 * blow, a turn of works, docking and climbing a beffroi, each after the shortest walk this turn
 * when out of reach; a walk too long for this turn cut where the points of action run out.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle, createBattleContext, distance, findUnit, type BattleState, type Scenario } from '@core/index.ts';
import { planAdvance, planClimb, planDock, planStrike, planStructureStrike } from '@core/battle/reach.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, flatTerrain } from './helpers.ts';
import { buildFixture, defaultUnits, freshBattle, IDS, spawn, withBroken, withUnit } from './siege-fixture.ts';

const SEED = 'strike-test';
const R = DEFAULT_RULES;
const REACH = R.damage.meleeReachM;

function battle(units: Scenario['units'], width = 48) {
  const ctx = createBattleContext(flatTerrain(width, 12, 1), R);
  return { ctx, state: createBattle(ctx, SEED, { units }) };
}

describe('planStrike', () => {
  it('strikes at once an enemy already within reach', () => {
    const { ctx, state } = battle([
      { id: 'atk', typeKey: 'soldier', position: centerOf(4, 5) },
      { id: 'def', typeKey: 'wallGuard', position: centerOf(5, 5) },
    ]);
    const plan = planStrike(ctx, state, 'atk', 'def');
    expect(plan?.move).toBeNull();
    expect(plan?.preview.melee).toBe(true);
  });

  it('walks a sergeant next to an enemy a few steps away, keeping the point of action the blow needs', () => {
    const { ctx, state } = battle([
      { id: 'atk', typeKey: 'soldier', position: centerOf(2, 5) },
      { id: 'def', typeKey: 'wallGuard', position: centerOf(12, 5) },
    ]);
    const plan = planStrike(ctx, state, 'atk', 'def');
    expect(plan?.move).not.toBeNull();
    const walk = plan!.move!;
    expect(distance(walk.destination, findUnit(state, 'def')!.position)).toBeLessThanOrEqual(REACH);
    expect(findUnit(state, 'atk')!.ap - walk.apSpent).toBeGreaterThanOrEqual(R.damage.attackApCost);
    // The two orders it stands for are accepted by the rules, the blow struck.
    const moved = applyCommand(ctx, state, { type: 'move', unitId: 'atk', to: walk.destination });
    expect(moved.rejection).toBeNull();
    const struck = applyCommand(ctx, moved.state, { type: 'attack', unitId: 'atk', targetId: 'def' });
    expect(struck.rejection).toBeNull();
    expect(struck.events.some((e) => e.type === 'unitAttacked' && e.attackerId === 'atk')).toBe(true);
  });

  it('walks an archer only as far as the shot needs', () => {
    const range = R.units['archer']!.attack!.rangeM;
    const { ctx, state } = battle(
      [
        { id: 'atk', typeKey: 'archer', position: centerOf(1, 5) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(1 + Math.ceil(range) + 4, 5) },
      ],
      Math.ceil(range) + 12,
    );
    const plan = planStrike(ctx, state, 'atk', 'def');
    expect(plan?.move).not.toBeNull();
    expect(plan!.preview.melee).toBe(false);
    const walked = distance(plan!.move!.destination, findUnit(state, 'atk')!.position);
    // Just past the gap, not up to the enemy.
    expect(walked).toBeLessThan(10);
    expect(plan!.preview.distanceM).toBeLessThanOrEqual(plan!.preview.effectiveRangeM);
  });

  it('cannot strike this turn an enemy beyond a whole turn’s walk', () => {
    const { ctx, state } = battle([
      { id: 'atk', typeKey: 'soldier', position: centerOf(1, 5) },
      { id: 'def', typeKey: 'wallGuard', position: centerOf(46, 5) },
    ]);
    expect(planStrike(ctx, state, 'atk', 'def')).toBeNull();
  });

  it('cannot strike twice in a turn, however near', () => {
    const { ctx, state } = battle([
      { id: 'atk', typeKey: 'soldier', position: centerOf(2, 5) },
      { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 5) },
    ]);
    const spent: BattleState = { ...state, units: state.units.map((u) => (u.id === 'atk' ? { ...u, actions: 0 } : u)) };
    expect(planStrike(ctx, spent, 'atk', 'def')).toBeNull();
  });

  it('does not walk onto a spot another man holds', () => {
    const { ctx, state } = battle([
      { id: 'atk', typeKey: 'soldier', position: centerOf(2, 5) },
      { id: 'def', typeKey: 'wallGuard', position: centerOf(10, 5) },
      { id: 'mate', typeKey: 'soldier', position: centerOf(9, 5) },
    ]);
    const plan = planStrike(ctx, state, 'atk', 'def');
    expect(plan?.move).not.toBeNull();
    expect(plan!.move!.destination).not.toEqual(findUnit(state, 'mate')!.position);
  });
});

describe('planAdvance: a walk beyond this turn is cut where the points of action run out', () => {
  it('walks the whole way when it is within reach', () => {
    const { ctx, state } = battle([{ id: 'atk', typeKey: 'soldier', position: centerOf(2, 5) }, { id: 'def', typeKey: 'wallGuard', position: centerOf(46, 5) }]);
    const r = planAdvance(ctx, state, 'atk', centerOf(8, 5));
    expect(r.ok && r.partial).toBe(false);
  });

  it('stops on the way, as far as he can, toward a point too far for this turn', () => {
    const { ctx, state } = battle([{ id: 'atk', typeKey: 'soldier', position: centerOf(1, 5) }, { id: 'def', typeKey: 'wallGuard', position: centerOf(46, 9) }]);
    const r = planAdvance(ctx, state, 'atk', centerOf(44, 5));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.partial).toBe(true);
    expect(r.plan.apSpent).toBeLessThanOrEqual(findUnit(state, 'atk')!.ap);
    // Toward the point asked, and most of a turn's walk: more than three quarters of what he can do.
    const walked = r.plan.destination.x - findUnit(state, 'atk')!.position.x;
    const fullWalk = (R.terrainLayers.find((l) => l.key === 'Plain')?.metersPerAp.foot ?? 0) * findUnit(state, 'atk')!.ap;
    expect(walked).toBeGreaterThan(fullWalk * 0.75);
    expect(Math.abs(r.plan.destination.z - 5.5)).toBeLessThan(2);
  });

  it('still refuses a place no path leads to', () => {
    const { ctx, state } = freshBattle();
    // Inside the courtyard, behind the closed gate and the wall: no way in.
    expect(planAdvance(ctx, state, IDS.soldier, centerOf(35, 12))).toEqual({ ok: false, reason: 'noPath' });
  });
});

describe('the siege deeds done after a walk', () => {
  const { ctx, state } = freshBattle();
  const open = withBroken(state, IDS.bridge);

  it('a ram rolls up to the gate, then strikes it', () => {
    const away = withUnit(open, IDS.ram, { position: centerOf(15, 9) });
    const plan = planStructureStrike(ctx, away, IDS.ram, IDS.gate);
    expect(plan?.move).not.toBeNull();
    const moved = applyCommand(ctx, away, { type: 'move', unitId: IDS.ram, to: plan!.move!.destination });
    expect(applyCommand(ctx, moved.state, { type: 'attackStructure', unitId: IDS.ram, structureId: IDS.gate }).rejection).toBeNull();
  });

  it('a ram still cannot strike a gate the raised drawbridge shields', () => {
    const away = withUnit(state, IDS.ram, { position: centerOf(15, 9) });
    expect(planStructureStrike(ctx, away, IDS.ram, IDS.gate)).toBeNull();
  });

  it('a beffroi rolls up to the wall and docks; a sergeant walks to it and climbs', () => {
    const f = buildFixture(R, [...defaultUnits(), spawn('att-tower', 'siegeTower', 15, 3)]);
    const s = createBattle(f.ctx, 'reach-tower', f.scenario);
    const dock = planDock(f.ctx, s, 'att-tower', IDS.wallA);
    expect(dock?.move).not.toBeNull();
    const rolled = applyCommand(f.ctx, s, { type: 'move', unitId: 'att-tower', to: dock!.move!.destination });
    const docked = applyCommand(f.ctx, rolled.state, { type: 'dockTower', unitId: 'att-tower', structureId: IDS.wallA });
    expect(docked.rejection).toBeNull();
    const climb = planClimb(f.ctx, docked.state, IDS.soldier, 'att-tower');
    expect(climb?.move).not.toBeNull();
    const walked = applyCommand(f.ctx, docked.state, { type: 'move', unitId: IDS.soldier, to: climb!.move!.destination });
    expect(applyCommand(f.ctx, walked.state, { type: 'climbTower', unitId: IDS.soldier, towerId: 'att-tower' }).rejection).toBeNull();
  });
});
