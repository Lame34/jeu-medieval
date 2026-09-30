/**
 * Basic utility AI (brief §9.6, J3): `decideUnit`'s choices on small hand-built terrains, and
 * `playTurn`'s harness guarantees (always ends with endTurn, never retries a rejected command,
 * stops the moment the battle ends).
 */
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createBattle,
  createBattleContext,
  findUnit,
  hashBattleState,
  sub,
  vec2,
  ApproachFields,
  decideUnit,
  playTurn,
  AI_WEIGHTS,
  TerrainLayer,
  type BattleState,
  type Command,
  type Scenario,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, fillRect, flatTerrain, rulesWithDamageOverrides, SEEDS } from './helpers.ts';

const SEED = SEEDS.aiPlanner;
const RULES = DEFAULT_RULES;

function makeCtx(width = 20, depth = 20, rules = RULES) {
  return createBattleContext(flatTerrain(width, depth, 1), rules);
}

describe('decideUnit: attacks a target already in range rather than moving', () => {
  it('returns a plain attack, with no leading move, when the target is already reachable', () => {
    const ctx = makeCtx(10, 10);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'archer', typeKey: 'archer', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'crossbowman', position: centerOf(1, 5) }, // distance 4, well within range
      ],
    });
    const commands = decideUnit(ctx, state, findUnit(state, 'archer')!);
    expect(commands).toEqual([{ type: 'attack', unitId: 'archer', targetId: 'def' }]);
  });
});

describe('decideUnit: a melee unit closes to contact and then attacks', () => {
  it('returns [move, attack], and both commands apply cleanly', () => {
    const ctx = makeCtx(10, 10);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'soldier', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(4, 0) },
      ],
    });
    const commands = decideUnit(ctx, state, findUnit(state, 'soldier')!);
    expect(commands.map((c) => c.type)).toEqual(['move', 'attack']);
    expect((commands[1] as { targetId: string }).targetId).toBe('def');

    let current = state;
    for (const command of commands) {
      const result = applyCommand(ctx, current, command);
      expect(result.rejection).toBeNull();
      current = result.state;
    }
    const soldier = findUnit(current, 'soldier')!;
    const def = findUnit(current, 'def')!;
    expect(Math.hypot(soldier.position.x - def.position.x, soldier.position.z - def.position.z)).toBeLessThanOrEqual(RULES.damage.meleeReachM);
  });
});

describe('decideUnit: a shooter without a reachable target ends on overwatch', () => {
  it('guards towards the nearest enemy instead of attacking or wandering off', () => {
    const ctx = makeCtx(120, 10);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'archer', typeKey: 'archer', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(100, 1) }, // far beyond rangeM + any reachable travel
      ],
    });
    // Just enough AP for the guard action itself, none to spare for a meaningful approach: the
    // only candidate spot ends up being the unit's own cell.
    const starved: BattleState = { ...state, units: state.units.map((u) => (u.id === 'archer' ? { ...u, ap: RULES.damage.attackApCost } : u)) };
    const archer = findUnit(starved, 'archer')!;
    const def = findUnit(starved, 'def')!;
    const commands = decideUnit(ctx, starved, archer);
    expect(commands).toEqual([{ type: 'overwatch', unitId: 'archer', direction: sub(def.position, archer.position) }]);
  });
});

describe('ApproachFields: prefers a reachable enemy over a closer, unreachable one', () => {
  function splitMap(): ReturnType<typeof flatTerrain> {
    const terrain = flatTerrain(20, 5, 1);
    fillRect(terrain, 10, 0, 10, 4, TerrainLayer.River); // impassable, full-width barrier
    return terrain;
  }

  it('is IMPASSABLE everywhere on our side when the only enemy is across the barrier', () => {
    const ctx = createBattleContext(splitMap(), RULES);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'mover', typeKey: 'soldier', position: centerOf(1, 2) },
        { id: 'unreachable', typeKey: 'wallGuard', position: centerOf(11, 2) }, // just across the river
      ],
    });
    const approach = new ApproachFields(ctx, state, 'attacker');
    expect(approach.costAt('foot', centerOf(1, 2))).toBe(Infinity);
  });

  it('becomes finite, and decreases towards a reachable enemy even if it is farther as the crow flies', () => {
    const ctx = createBattleContext(splitMap(), RULES);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'mover', typeKey: 'soldier', position: centerOf(1, 2) },
        { id: 'unreachable', typeKey: 'wallGuard', position: centerOf(11, 2) }, // across the river: closer, but unreachable
        { id: 'reachable', typeKey: 'crossbowman', position: centerOf(8, 2) }, // same side, farther away
      ],
    });
    const approach = new ApproachFields(ctx, state, 'attacker');
    const farFromReachable = approach.costAt('foot', centerOf(1, 2));
    const closeToReachable = approach.costAt('foot', centerOf(5, 2));
    expect(farFromReachable).toBeLessThan(Infinity);
    expect(closeToReachable).toBeLessThan(farFromReachable); // genuinely closer by the only walkable path
  });
});

describe('decideUnit: a defender beyond engagement range holds position', () => {
  it('returns no commands when the nearest enemy is farther than defenderEngageRadiusM', () => {
    const ctx = makeCtx(60, 10);
    const beyond = AI_WEIGHTS.defenderEngageRadiusM + 5;
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'guard', typeKey: 'wallGuard', position: centerOf(1, 1) },
        { id: 'atk', typeKey: 'soldier', position: centerOf(1 + Math.ceil(beyond), 1) },
      ],
      firstFaction: 'defender',
    });
    expect(decideUnit(ctx, state, findUnit(state, 'guard')!)).toEqual([]);
  });
});

describe('decideUnit: a fleeing unit receives no orders', () => {
  it('returns [] regardless of the tactical situation', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'soldier', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) }, // adjacent: would clearly attack otherwise
      ],
    });
    const fleeing: BattleState = { ...state, units: state.units.map((u) => (u.id === 'soldier' ? { ...u, morale: RULES.morale.fleeBelow - 1 } : u)) };
    expect(decideUnit(ctx, fleeing, findUnit(fleeing, 'soldier')!)).toEqual([]);
  });
});

describe('playTurn: always ends with endTurn (when the battle is still ongoing)', () => {
  it('hands the turn over after issuing every unit’s commands', () => {
    const ctx = makeCtx(10, 10);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'soldier', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(8, 8) },
      ],
    });
    const turn = playTurn(ctx, state, 'attacker');
    expect(turn.commands[turn.commands.length - 1]).toEqual({ type: 'endTurn' });
    expect(turn.state.activeFaction).toBe('defender');
    expect(turn.state.status).toBe('ongoing');
  });
});

describe('playTurn: stops immediately once the battle ends, without ending the turn', () => {
  it('never reaches the second unit, and issues no endTurn, once the last defender dies', () => {
    const rules = rulesWithDamageOverrides({ hitChanceMin: 1, hitChanceMax: 1, critChance: 1 });
    const ctx = makeCtx(10, 10, rules);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'a-soldier', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'z-idle', typeKey: 'knight', position: centerOf(9, 9) }, // far away, never gets a turn
        { id: 'def', typeKey: 'wallGuard', position: centerOf(1, 0) }, // adjacent: dies to the first blow
      ],
    });
    const lowHp: BattleState = { ...state, units: state.units.map((u) => (u.id === 'def' ? { ...u, hp: 1 } : u)) };
    const turn = playTurn(ctx, lowHp, 'attacker');
    expect(turn.commands).toEqual([{ type: 'attack', unitId: 'a-soldier', targetId: 'def' }]);
    expect(turn.state.status).toBe('attackerWon');
    expect(turn.events.some((e) => e.type === 'battleEnded')).toBe(true);
  });
});

describe('playTurn: skips a command rejected mid-sequence and moves on, without retrying it', () => {
  it('drops the follow-up attack when an enemy overwatch shot kills the mover first', () => {
    // decideUnit plans [move, attack] without modelling enemy overwatch: it scores the attack as
    // if the move always succeeds. Here the watcher kills the mover en route, so the planned
    // attack (issued against an already-dead unit) must be rejected, not retried, and the turn
    // must carry on to the next unit.
    const rules = rulesWithDamageOverrides({ hitChanceMin: 1, hitChanceMax: 1, critChance: 1 });
    const ctx = makeCtx(20, 5, rules);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'a-mover', typeKey: 'soldier', position: centerOf(0, 2) },
        { id: 'z-safe', typeKey: 'knight', position: centerOf(0, 4) }, // far from the watcher's cone/range
        { id: 'watcher', typeKey: 'crossbowman', position: centerOf(10, 2) },
      ],
      firstFaction: 'defender', // so "watcher" can set overwatch on its own turn first
    });
    const guarding = applyCommand(ctx, state, { type: 'overwatch', unitId: 'watcher', direction: vec2(-1, 0) });
    expect(guarding.rejection).toBeNull();
    const handedOver = applyCommand(ctx, guarding.state, { type: 'endTurn' }); // now the attacker's turn
    const lowHp: BattleState = { ...handedOver.state, units: handedOver.state.units.map((u) => (u.id === 'a-mover' ? { ...u, hp: 1 } : u)) };

    const turn = playTurn(ctx, lowHp, 'attacker');
    const rejected = turn.events.filter((e) => e.type === 'commandRejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'unitDead' });
    expect(turn.events.filter((e) => e.type === 'unitDied').some((e) => (e as { unitId: string }).unitId === 'a-mover')).toBe(true);
    // The rejected command is not retried: it appears exactly once in the issued command log.
    const attackCommands = turn.commands.filter((c) => c.type === 'attack' && c.unitId === 'a-mover');
    expect(attackCommands).toHaveLength(1);
    expect(turn.state.status).toBe('ongoing'); // z-safe (and the watcher) are still alive
    expect(turn.commands[turn.commands.length - 1]).toEqual({ type: 'endTurn' }); // the turn still completes
  });
});

describe('playTurn and decideUnit: determinism', () => {
  it('replaying playTurn from the same state twice yields the same commands and state hash', () => {
    const ctx = makeCtx(15, 15);
    const state = createBattle(ctx, SEED, {
      units: [
        { id: 'a-soldier', typeKey: 'soldier', position: centerOf(0, 0) },
        { id: 'a-archer', typeKey: 'archer', position: centerOf(0, 5) },
        { id: 'def-guard', typeKey: 'wallGuard', position: centerOf(8, 1) },
        { id: 'def-crossbow', typeKey: 'crossbowman', position: centerOf(8, 6) },
      ] satisfies Scenario['units'],
    });
    const a = playTurn(ctx, state, 'attacker');
    const b = playTurn(ctx, state, 'attacker');
    expect(a.commands).toEqual(b.commands satisfies readonly Command[]);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
  });
});
