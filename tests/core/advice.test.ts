/**
 * « Que ferait Guillaume ? » (src/core/ai/advice.ts): the AI's choice for one of the player's men,
 * the facts the HUD tells, orders the rules accept, and nothing the player's side cannot see.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, createBattle, createBattleContext, type BattleContext, type BattleState, type Command, type Scenario } from '@core/index.ts';
import { adviseUnit } from '@core/ai/advice.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, flatTerrain } from './helpers.ts';
import { freshBattle, IDS, withBroken } from './siege-fixture.ts';

const SEED = 'advice-test';
const FOG_SIGHT_M = DEFAULT_RULES.weather.fogSightM;

function battle(units: Scenario['units'], weather: Scenario['weather'] = 'clear') {
  const ctx = createBattleContext(flatTerrain(64, 16, 1), DEFAULT_RULES);
  return { ctx, state: createBattle(ctx, SEED, { units, weather }) };
}

/** Plays the orders on the real battle: every one accepted. */
function play(ctx: BattleContext, state: BattleState, commands: readonly Command[]): BattleState {
  let s = state;
  for (const c of commands) {
    const r = applyCommand(ctx, s, c);
    expect(r.rejection, c.type).toBeNull();
    s = r.state;
  }
  return s;
}

describe('adviseUnit', () => {
  it('a sergeant beside a militiaman strikes him, and says the odds', () => {
    const { ctx, state } = battle([
      { id: 'att', typeKey: 'soldier', position: centerOf(10, 8) },
      { id: 'def', typeKey: 'militia', position: centerOf(11, 8) },
    ]);
    const a = adviseUnit(ctx, state, 'att');
    expect(a.deed).toBe('strike');
    expect(a.targetId).toBe('def');
    expect(a.hitChance).toBeGreaterThan(0);
    play(ctx, state, a.commands);
  });

  it('an archer shoots, after a walk when the enemy is out of his range, and the walk is told', () => {
    const { ctx, state } = battle([
      { id: 'att', typeKey: 'archer', position: centerOf(2, 8) },
      { id: 'def', typeKey: 'militia', position: centerOf(50, 8) },
    ]);
    const a = adviseUnit(ctx, state, 'att');
    expect(['shoot', 'advance', 'guard']).toContain(a.deed);
    expect(a.walk).not.toBeNull();
    expect(a.walk?.plan.apSpent).toBeGreaterThan(0);
    expect(a.walk?.threats).toBeGreaterThanOrEqual(0);
    play(ctx, state, a.commands);
  });

  it('a man of the side not playing, or a fallen one, is told to hold', () => {
    const { ctx, state } = battle([
      { id: 'att', typeKey: 'soldier', position: centerOf(10, 8) },
      { id: 'def', typeKey: 'militia', position: centerOf(11, 8) },
    ]);
    expect(adviseUnit(ctx, state, 'def')).toEqual({ commands: [], walk: null, deed: 'hold' });
    const fallen = { ...state, units: state.units.map((u) => (u.id === 'att' ? { ...u, alive: false } : u)) };
    expect(adviseUnit(ctx, fallen, 'att').deed).toBe('hold');
  });

  it('in the fog, never aims at an enemy the player cannot see', () => {
    const { ctx, state } = battle(
      [
        { id: 'att', typeKey: 'archer', position: centerOf(2, 8) },
        { id: 'def', typeKey: 'militia', position: centerOf(2 + FOG_SIGHT_M + 10, 8) },
      ],
      'fog',
    );
    const a = adviseUnit(ctx, state, 'att');
    expect(a.targetId).toBeUndefined();
    expect(a.commands.some((c) => c.type === 'attack')).toBe(false);
  });

  it('a ram waits for the drawbridge to come down, then goes for the gate', () => {
    const { ctx, state } = freshBattle('advice-ram');
    expect(adviseUnit(ctx, state, IDS.ram)).toMatchObject({ deed: 'hold', waitingFor: 'drawbridge' });
    const open = withBroken(state, IDS.bridge);
    const a = adviseUnit(ctx, open, IDS.ram);
    expect(['siegeBlow', 'advance']).toContain(a.deed);
    play(ctx, open, a.commands);
  });
});
