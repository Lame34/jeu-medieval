/**
 * End-to-end determinism: the core's central promise is that a battle is fully described by
 * `seed + scenario + Command[]`. This file builds one synthetic 64x64 map (relief, a forest
 * patch, a river crossed by a single ford) and replays 1000 pseudo-random commands (a mix of
 * valid/invalid moves and endTurn) through it multiple times, checking that everything that is
 * supposed to be reproducible actually is.
 */
import { describe, expect, it } from 'vitest';
import {
  Rng,
  TerrainLayer,
  createBattleContext,
  createTerrainData,
  hashBattleState,
  hashValue,
  replay,
  setHeightAtCorner,
  vec2,
  type BattleContext,
  type Command,
  type Scenario,
  type TerrainData,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { fillRect } from './helpers.ts';

const MAP_SIZE = 64;
const COMMAND_COUNT = 1000;
const SEED = 'determinism-e2e-seed';

/** A 64x64 map with analytic relief, a forest block, and a river crossed by a single ford. */
function buildSyntheticMap(): TerrainData {
  const t = createTerrainData(MAP_SIZE, MAP_SIZE, 1);
  for (let iz = 0; iz <= MAP_SIZE; iz++) {
    for (let ix = 0; ix <= MAP_SIZE; ix++) {
      // Purely analytic (no RNG): gentle rolling relief, well under every profile's max grade.
      setHeightAtCorner(t, ix, iz, 2 * Math.sin(ix * 0.15) * Math.cos(iz * 0.12));
    }
  }
  fillRect(t, 10, 10, 20, 20, TerrainLayer.Forest);
  fillRect(t, 32, 0, 32, MAP_SIZE - 1, TerrainLayer.River); // a north-south river
  fillRect(t, 32, 32, 32, 32, TerrainLayer.Ford); // the only crossing
  return t;
}

const UNIT_IDS = ['atk-soldier', 'atk-archer', 'atk-knight', 'def-guard', 'def-crossbow', 'def-officer'] as const;

function buildScenario(): Scenario {
  return {
    units: [
      { id: 'atk-soldier', typeKey: 'soldier', position: vec2(5.5, 5.5) },
      { id: 'atk-archer', typeKey: 'archer', position: vec2(25.5, 50.5) },
      { id: 'atk-knight', typeKey: 'knight', position: vec2(15.5, 45.5) },
      { id: 'def-guard', typeKey: 'wallGuard', position: vec2(40.5, 5.5) },
      { id: 'def-crossbow', typeKey: 'crossbowman', position: vec2(55.5, 50.5) },
      { id: 'def-officer', typeKey: 'officer', position: vec2(45.5, 45.5) },
    ],
  };
}

/**
 * A fixed, deterministic sequence of 1000 commands mixing valid/invalid moves and endTurn.
 * Command 0 is always a plain, clearly-valid move (used by the "hash changes" test to guarantee
 * a real divergence when mutated).
 */
function buildCommands(): Command[] {
  const rng = Rng.create(SEED);
  const commands: Command[] = [{ type: 'move', unitId: 'atk-soldier', to: vec2(6.5, 6.5) }];
  const OUT_OF_BOUNDS_MARGIN = 5;
  for (let i = 1; i < COMMAND_COUNT; i++) {
    if (rng.chance(0.15)) {
      commands.push({ type: 'endTurn' });
      continue;
    }
    const unitId = rng.pick(UNIT_IDS);
    const to = vec2(rng.float(-OUT_OF_BOUNDS_MARGIN, MAP_SIZE + OUT_OF_BOUNDS_MARGIN), rng.float(-OUT_OF_BOUNDS_MARGIN, MAP_SIZE + OUT_OF_BOUNDS_MARGIN));
    commands.push({ type: 'move', unitId, to });
  }
  return commands;
}

function freshContext(terrain: TerrainData): BattleContext {
  return createBattleContext(terrain, DEFAULT_RULES);
}

describe('end-to-end determinism', () => {
  const terrain = buildSyntheticMap();
  const scenario = buildScenario();
  const commands = buildCommands();

  it('replaying the same seed + scenario + commands twice yields the same state hash and events', () => {
    const resultA = replay(freshContext(terrain), SEED, scenario, commands);
    const resultB = replay(freshContext(terrain), SEED, scenario, commands);
    expect(hashBattleState(resultA.state)).toBe(hashBattleState(resultB.state));
    expect(resultA.events.length).toBe(resultB.events.length);
    expect(hashValue(resultA.events)).toBe(hashValue(resultB.events));
  });

  it('a JSON round trip of the commands (stringify/parse) replays to the exact same hash', () => {
    const original = replay(freshContext(terrain), SEED, scenario, commands);
    const roundTripped = JSON.parse(JSON.stringify(commands)) as Command[];
    const afterRoundTrip = replay(freshContext(terrain), SEED, scenario, roundTripped);
    expect(hashBattleState(afterRoundTrip.state)).toBe(hashBattleState(original.state));
    expect(hashValue(afterRoundTrip.events)).toBe(hashValue(original.events));
  });

  it('changing one command changes the resulting hash', () => {
    const original = replay(freshContext(terrain), SEED, scenario, commands);
    const mutated = commands.slice();
    const first = mutated[0];
    expect(first?.type).toBe('move'); // sanity: we are actually replacing a move, not a no-op
    mutated[0] = { type: 'endTurn' };
    const afterMutation = replay(freshContext(terrain), SEED, scenario, mutated);
    expect(hashBattleState(afterMutation.state)).not.toBe(hashBattleState(original.state));
  });

  it('produced at least one commandRejected and one successful unitMoved event (the mix is real)', () => {
    const result = replay(freshContext(terrain), SEED, scenario, commands);
    const rejected = result.events.filter((e) => e.type === 'commandRejected');
    const moved = result.events.filter((e) => e.type === 'unitMoved');
    expect(rejected.length).toBeGreaterThan(0);
    expect(moved.length).toBeGreaterThan(0);
  });
});
