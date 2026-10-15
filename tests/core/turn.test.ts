/**
 * Who can still act this turn (src/core/battle/turn.ts): the end-of-turn warning and the Tab key
 * count only the men who can still move or do something, on the synthetic castle of
 * siege-fixture.ts.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle } from '@core/index.ts';
import { apSpentFor } from '@core/battle/movement.ts';
import { canStillAct } from '@core/battle/turn.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { buildFixture, defaultUnits, IDS, spawn, withUnit } from './siege-fixture.ts';

const TOWER = 'att-tower';
const { ctx, scenario } = buildFixture(DEFAULT_RULES, [...defaultUnits(), spawn(TOWER, 'siegeTower', 19, 3)]);
const state = createBattle(ctx, 'turn-test', scenario);
const unit = (s: typeof state, id: string) => {
  const u = s.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};

describe('canStillAct', () => {
  it('a man of the side to play, with points of action left, can act', () => {
    expect(canStillAct(ctx, state, unit(state, IDS.soldier))).toBe(true);
  });

  it('without points of action he cannot, even with his deed of the turn unspent', () => {
    const spent = withUnit(state, IDS.soldier, { ap: 0, actions: DEFAULT_RULES.damage.actionsPerTurn });
    expect(canStillAct(ctx, spent, unit(spent, IDS.soldier))).toBe(false);
  });

  it('a man in flight, a fallen man and a man of the other side cannot', () => {
    const fleeing = withUnit(state, IDS.soldier, { morale: DEFAULT_RULES.morale.fleeBelow - 1 });
    expect(canStillAct(ctx, fleeing, unit(fleeing, IDS.soldier))).toBe(false);
    const fallen = withUnit(state, IDS.soldier, { alive: false });
    expect(canStillAct(ctx, fallen, unit(fallen, IDS.soldier))).toBe(false);
    expect(canStillAct(ctx, state, unit(state, IDS.guardA))).toBe(false);
  });

  it('a beffroi accolé au mur no longer acts, whatever points of action it gets back', () => {
    const docked = applyCommand(ctx, state, { type: 'dockTower', unitId: TOWER, structureId: IDS.wallA });
    expect(docked.rejection).toBeNull();
    const refreshed = withUnit(docked.state, TOWER, { ap: unit(docked.state, TOWER).ap + 1, actions: 1 });
    expect(canStillAct(ctx, refreshed, unit(refreshed, TOWER))).toBe(false);
  });

  it('the rules it relies on: every step and every deed costs points of action', () => {
    const r = DEFAULT_RULES;
    expect(r.damage.attackApCost).toBeGreaterThan(0);
    expect(r.structures.towerClimbAp).toBeGreaterThan(0);
    const shortestStep = 1 / Math.max(...r.terrainLayers.flatMap((l) => Object.values(l.metersPerAp)));
    expect(apSpentFor(shortestStep)).toBeGreaterThan(0);
    for (const hero of Object.values(r.heroes)) for (const a of hero.abilities) if (a.target === 'self' || a.target === 'allyEngine') expect(a.apCost, a.id).toBeGreaterThan(0);
  });
});
