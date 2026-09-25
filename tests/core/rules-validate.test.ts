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
