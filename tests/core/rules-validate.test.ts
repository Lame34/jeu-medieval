import { describe, expect, it } from 'vitest';
import { RulesValidationError, TERRAIN_LAYER_COUNT, TerrainLayer, validateRules, type RawRuleFiles } from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import damage from '@data/damage.json' with { type: 'json' };
import terrain from '@data/terrain.json' with { type: 'json' };
import units from '@data/units.json' with { type: 'json' };

/** Deep-clones the raw JSON fixtures so each test can mutate its own copy safely. */
function rawFiles(): RawRuleFiles {
  return structuredClone({ terrain, units, damage }) as RawRuleFiles;
}

/** Runs `fn` and returns the thrown error, or fails the test if it did not throw. */
function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected function to throw, but it did not');
}

describe('DEFAULT_RULES', () => {
  it('loads without throwing and covers every terrain layer', () => {
    expect(DEFAULT_RULES.terrainLayers).toHaveLength(TERRAIN_LAYER_COUNT);
    for (const layer of DEFAULT_RULES.terrainLayers) expect(layer).toBeDefined();
  });

  it('accepts a unit whose attack is null (non-combat unit, e.g. the siege tower)', () => {
    expect(DEFAULT_RULES.units['siegeTower']?.attack).toBeNull();
  });

  it('accepts a unit whose attack is a full rule object', () => {
    expect(DEFAULT_RULES.units['archer']?.attack).toEqual({
      type: 'piercing',
      power: 6,
      rangeM: 35,
      accuracy: 0.7,
    });
  });
});

describe('validateRules error reporting', () => {
  it('rejects an unknown terrain layer key with the offending path', () => {
    const raw = rawFiles();
    (raw.terrain as { layers: Record<string, unknown> }).layers['NotALayer'] = (raw.terrain as { layers: Record<string, unknown> }).layers['Plain'];
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('terrain.layers');
    expect((err as Error).message).toContain('NotALayer');
  });

  it('rejects a number outside its declared range, with the JSON path', () => {
    const raw = rawFiles();
    (raw.damage as { critChance: number }).critChance = 1.5; // must be in [0, 1]
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.critChance');
  });

  it('rejects an invalid enum value, with the JSON path', () => {
    const raw = rawFiles();
    (raw.terrain as { layers: Record<string, { cover: string }> }).layers['Plain']!.cover = 'invisible';
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('terrain.layers.Plain.cover');
  });

  it('rejects a non-object top-level section', () => {
    const raw = rawFiles();
    (raw as { terrain: unknown }).terrain = 'not an object';
    expect(() => validateRules(raw)).toThrow(RulesValidationError);
  });

  it('rejects a unit with a missing/invalid tags array', () => {
    const raw = rawFiles();
    (raw.units as { units: Record<string, { tags: unknown }> }).units['archer']!.tags = 'not-an-array';
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('units.archer.tags');
  });

  it('still accepts a null attack after a deep clone/mutation round trip', () => {
    const raw = rawFiles();
    const rules = validateRules(raw);
    expect(rules.units['siegeTower']?.attack).toBeNull();
  });
});

describe('validateRules: terrain.layers.*.flatDeck', () => {
  it('defaults to false when the key is absent from the JSON (e.g. Plain)', () => {
    const rules = validateRules(rawFiles());
    expect(rules.terrainLayers[TerrainLayer.Plain]?.flatDeck).toBe(false);
  });

  it('accepts an explicit flatDeck: true (Bridge, in the real data file)', () => {
    const rules = validateRules(rawFiles());
    expect(rules.terrainLayers[TerrainLayer.Bridge]?.flatDeck).toBe(true);
  });

  it('rejects a non-boolean flatDeck value, with the JSON path', () => {
    const raw = rawFiles();
    (raw.terrain as { layers: Record<string, { flatDeck?: unknown }> }).layers['Bridge']!.flatDeck = 'yes';
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('terrain.layers.Bridge.flatDeck');
  });
});

describe('validateRules: J3 combat fields (damage.*)', () => {
  it('accepts the shipped attackApCost/actionsPerTurn (integers) and exposes them', () => {
    expect(Number.isInteger(DEFAULT_RULES.damage.attackApCost)).toBe(true);
    expect(Number.isInteger(DEFAULT_RULES.damage.actionsPerTurn)).toBe(true);
  });

  it('rejects a non-integer attackApCost, with the JSON path', () => {
    const raw = rawFiles();
    (raw.damage as { attackApCost: number }).attackApCost = 1.5;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.attackApCost');
  });

  it('rejects a non-integer actionsPerTurn, with the JSON path', () => {
    const raw = rawFiles();
    (raw.damage as { actionsPerTurn: number }).actionsPerTurn = 1.5;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.actionsPerTurn');
  });

  it.each([
    ['riposteAccuracyFactor', -0.1],
    ['riposteAccuracyFactor', 1.1],
    ['obscurancePenalty', -0.1],
    ['obscurancePenalty', 1.1],
  ] as const)('rejects %s outside [0, 1] (got %d)', (field, value) => {
    const raw = rawFiles();
    (raw.damage as Record<string, number>)[field] = value;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain(`damage.${field}`);
  });

  it('accepts the boundary values 0 and 1 for riposteAccuracyFactor and obscurancePenalty', () => {
    const raw = rawFiles();
    (raw.damage as { riposteAccuracyFactor: number; obscurancePenalty: number }).riposteAccuracyFactor = 0;
    (raw.damage as { riposteAccuracyFactor: number; obscurancePenalty: number }).obscurancePenalty = 1;
    expect(() => validateRules(raw)).not.toThrow();
  });

  it('rejects a negative directionalCoverReachM, with the JSON path', () => {
    const raw = rawFiles();
    (raw.damage as { directionalCoverReachM: number }).directionalCoverReachM = -0.1;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.directionalCoverReachM');
  });

  it('accepts directionalCoverReachM === 0 (no directional cover at all)', () => {
    const raw = rawFiles();
    (raw.damage as { directionalCoverReachM: number }).directionalCoverReachM = 0;
    expect(() => validateRules(raw)).not.toThrow();
  });

  it('rejects a non-integer minDamageOnHit, with the JSON path', () => {
    const raw = rawFiles();
    (raw.damage as { minDamageOnHit: number }).minDamageOnHit = 0.5;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.minDamageOnHit');
  });
});

describe('validateRules: overwatch fields (damage.*)', () => {
  it.each([-0.1, 180.1])('rejects overwatchHalfAngleDeg outside [0, 180] (got %d)', (value) => {
    const raw = rawFiles();
    (raw.damage as { overwatchHalfAngleDeg: number }).overwatchHalfAngleDeg = value;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.overwatchHalfAngleDeg');
  });

  it('accepts the boundary values 0 and 180 for overwatchHalfAngleDeg', () => {
    const raw = rawFiles();
    (raw.damage as { overwatchHalfAngleDeg: number }).overwatchHalfAngleDeg = 0;
    expect(() => validateRules(raw)).not.toThrow();
    (raw.damage as { overwatchHalfAngleDeg: number }).overwatchHalfAngleDeg = 180;
    expect(() => validateRules(raw)).not.toThrow();
  });

  it.each([-0.1, 1.1])('rejects overwatchAccuracyFactor outside [0, 1] (got %d)', (value) => {
    const raw = rawFiles();
    (raw.damage as { overwatchAccuracyFactor: number }).overwatchAccuracyFactor = value;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.overwatchAccuracyFactor');
  });

  it('rejects overwatchSampleM <= 0, with the JSON path', () => {
    const raw = rawFiles();
    (raw.damage as { overwatchSampleM: number }).overwatchSampleM = 0;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.overwatchSampleM');
  });
});

describe('validateRules: damage.morale', () => {
  it('loads the shipped morale section with shakenBelow >= fleeBelow', () => {
    expect(DEFAULT_RULES.morale.shakenBelow).toBeGreaterThanOrEqual(DEFAULT_RULES.morale.fleeBelow);
  });

  it('rejects a non-integer shakenApPenalty, with the JSON path', () => {
    const raw = rawFiles();
    (raw.damage as { morale: { shakenApPenalty: number } }).morale.shakenApPenalty = 0.5;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.morale.shakenApPenalty');
  });

  it('rejects shakenBelow below fleeBelow (the bands would overlap incoherently)', () => {
    const raw = rawFiles();
    const morale = (raw.damage as { morale: { fleeBelow: number; shakenBelow: number } }).morale;
    morale.shakenBelow = morale.fleeBelow - 1;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.morale.shakenBelow');
  });

  it('rejects fleeBelow above morale.max, with the JSON path', () => {
    const raw = rawFiles();
    const morale = (raw.damage as { morale: { max: number; fleeBelow: number } }).morale;
    morale.fleeBelow = morale.max + 1;
    const err = captureThrow(() => validateRules(raw));
    expect(err).toBeInstanceOf(RulesValidationError);
    expect((err as Error).message).toContain('damage.morale.fleeBelow');
  });

  it('rejects a missing morale section entirely', () => {
    const raw = rawFiles();
    delete (raw.damage as { morale?: unknown }).morale;
    expect(() => validateRules(raw)).toThrow(RulesValidationError);
  });
});
