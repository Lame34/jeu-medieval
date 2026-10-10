/**
 * Every battle the campaign ships (J6) holds on its own map: the map validates (approaches,
 * readability), and the castle's scenario builds with each stratagem — spawns, reinforcements,
 * structures and causeways accepted by createBattle — with a garrison to fight and an army to
 * fight it. The tutorial is the same battle every time.
 */
import { describe, expect, it } from 'vitest';
import { createBattle, createBattleContext, hashBattleState, isPassable, type Scenario } from '@core/index.ts';
import { moatsOf } from '@core/battle/moat.ts';
import { planStructures } from '@core/battle/structures.ts';
import { battleEffects, shapeScenario } from '@core/campaign/scenario.ts';
import type { CampaignBattle, Stratagem } from '@core/campaign/types.ts';
import { generateBattleMap } from '@core/worldgen/battle.ts';
import { validateBattleMap } from '@core/worldgen/validate-map.ts';
import { CAMPAIGN, DEFAULT_RULES } from '@data/index.ts';

/** Each map takes a few seconds to generate and validate. */
const MAP_TIMEOUT_MS = 90_000;
/** A campaign battle always has at least this many defenders, and attackers before the heroes join. */
const MIN_GARRISON = 6;
const MIN_ARMY = 11;

function check(battle: CampaignBattle, stratagems: readonly Stratagem[]): string[] {
  const { layout, castle, forestCoverage } = generateBattleMap({ seed: battle.seed, castleIndex: battle.castleIndex });
  expect(validateBattleMap(layout, castle, DEFAULT_RULES, forestCoverage).problems).toEqual([]);
  const ctx = createBattleContext(layout.terrain, DEFAULT_RULES, layout.deck, planStructures(layout, DEFAULT_RULES.structures), moatsOf(layout));
  const base: Scenario = {
    units: layout.units.flatMap((m) => {
      const type = DEFAULT_RULES.units[m.typeKey];
      return type && isPassable(ctx.nav, type.movement, Math.floor(m.position.x), Math.floor(m.position.z)) ? [{ id: m.id, typeKey: m.typeKey, position: m.position }] : [];
    }),
    firstFaction: 'attacker',
  };
  const hashes: string[] = [];
  for (const plan of stratagems.length > 0 ? stratagems : [null]) {
    const scenario = shapeScenario(ctx, base, battleEffects(battle, plan));
    const state = createBattle(ctx, battle.seed, scenario);
    expect(state.units.filter((u) => u.faction === 'defender').length).toBeGreaterThanOrEqual(MIN_GARRISON);
    expect(state.units.filter((u) => u.faction === 'attacker').length).toBeGreaterThanOrEqual(MIN_ARMY);
    hashes.push(hashBattleState(state));
  }
  return hashes;
}

describe('the campaign’s battles on their maps', () => {
  it('the tutorial builds, and the same each time', () => {
    expect(check(CAMPAIGN.tutorial, [])).toEqual(check(CAMPAIGN.tutorial, []));
  }, MAP_TIMEOUT_MS * 2);

  for (const level of CAMPAIGN.levels) {
    it(`${level.name}: each of the three plans builds a battle`, () => {
      expect(new Set(check(level, level.stratagems)).size).toBe(level.stratagems.length);
    }, MAP_TIMEOUT_MS);
  }
});
