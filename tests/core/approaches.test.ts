/**
 * The five assault approaches judged on the real map 'siege-1' (src/core/battle/approaches.ts) and the
 * map validator that relies on them (src/core/worldgen/validate-map.ts). Map generation (~1.2 s) and
 * each viableApproaches call (~2 s) are slow: the map is built once in beforeAll, with a long timeout.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { validateRules, type GameRules } from '@core/index.ts';
import { ASSAULT_APPROACHES, viableApproaches, type AssaultApproach } from '@core/battle/approaches.ts';
import { generateBattleMap } from '@core/worldgen/battle.ts';
import { validateBattleMap } from '@core/worldgen/validate-map.ts';
import type { GeneratedMap } from '@core/worldgen/battle.ts';
import type { WorldLayout } from '@core/worldgen/types.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { rawRuleFiles } from './helpers.ts';

const SEED = 'siege-1';
const CASTLE_INDEX = 1;
const HEAVY_TIMEOUT_MS = 60_000;
const MIN_VIABLE = 3;

let map: GeneratedMap;
let base: ReturnType<typeof viableApproaches>;

const withoutBridge = (layout: WorldLayout): WorldLayout => ({
  ...layout,
  gates: layout.gates.map((g) => ({ ...g, drawbridge: false, winchOperatorId: undefined })),
});

function rulesWithoutCatapult(): GameRules {
  const raw = rawRuleFiles();
  delete (raw.units as { units: Record<string, unknown> }).units['catapult'];
  return validateRules(raw);
}

beforeAll(() => {
  map = generateBattleMap({ seed: SEED, castleIndex: CASTLE_INDEX });
  base = viableApproaches(map.layout, DEFAULT_RULES);
}, HEAVY_TIMEOUT_MS);

describe('viableApproaches on siege-1 (castle 1)', () => {
  it('allows all five approaches, each with a note', () => {
    expect(base.viable).toEqual([...ASSAULT_APPROACHES]);
    for (const a of ASSAULT_APPROACHES) expect(base.notes[a].length).toBeGreaterThan(0);
  });

  it('is deterministic: the same map gives the same verdict', () => {
    expect(viableApproaches(map.layout, DEFAULT_RULES)).toEqual(base);
  }, HEAVY_TIMEOUT_MS);

  it('without a drawbridge, "drawbridge" and "ram" are out and the notes say why', () => {
    const r = viableApproaches(withoutBridge(map.layout), DEFAULT_RULES);
    expect(r.viable).not.toContain('drawbridge');
    expect(r.viable).not.toContain('ram');
    expect(r.notes.drawbridge).toBe('pas de pont-levis');
    // The gate is still there: the ram is judged against it, and cannot reach it across the moat.
    expect(r.notes.ram).toBe('la porte reste hors d’atteinte');
    // The other approaches do not depend on the bridge.
    expect(r.viable).toContain('breach');
  }, HEAVY_TIMEOUT_MS);

  it('without a winch operator, the bridge itself must be within a fire arrow\'s shot', () => {
    const layout: WorldLayout = { ...map.layout, gates: map.layout.gates.map((g) => ({ ...g, winchOperatorId: undefined })) };
    const r = viableApproaches(layout, DEFAULT_RULES);
    expect(r.notes.drawbridge).not.toBe('treuilliste à portée de tir');
    expect(['pont à portée de flèche enflammée', 'ni treuilliste ni pont à portée']).toContain(r.notes.drawbridge);
  }, HEAVY_TIMEOUT_MS);

  it('without a moat there is no causeway: sap and siege tower are out', () => {
    const layout: WorldLayout = { ...map.layout, water: map.layout.water.filter((w) => w.kind !== 'moat') };
    const r = viableApproaches(layout, DEFAULT_RULES);
    expect(r.viable).not.toContain('sap');
    expect(r.viable).not.toContain('siegeTower');
    expect(r.notes.sap).toBe('aucun pied de mur atteignable');
    expect(r.notes.siegeTower).toBe('aucun mur atteignable par la tour');
  }, HEAVY_TIMEOUT_MS);

  it('without a deployment zone the troops start from the camera focus and the verdict still comes', () => {
    const r = viableApproaches({ ...map.layout, deployment: undefined }, DEFAULT_RULES);
    expect(Object.keys(r.notes).sort()).toEqual([...ASSAULT_APPROACHES].sort());
  }, HEAVY_TIMEOUT_MS);

  it('without a catapult in the rules, "breach" is out', () => {
    const r = viableApproaches(map.layout, rulesWithoutCatapult());
    expect(r.viable).not.toContain('breach' satisfies AssaultApproach);
    expect(r.notes.breach).toBe('pas de catapulte');
    expect(r.viable).toContain('drawbridge');
  }, HEAVY_TIMEOUT_MS);
});

describe('validateBattleMap', () => {
  it('accepts the real map on the approaches count and reports the viable list', () => {
    const report = validateBattleMap(map.layout, map.castle, DEFAULT_RULES, map.forestCoverage);
    expect(report.viable).toEqual([...ASSAULT_APPROACHES]);
    expect(report.problems.some((p) => p.includes('viable approaches'))).toBe(false);
    expect(report.forestCoverage).toBe(map.forestCoverage);
  }, HEAVY_TIMEOUT_MS);

  it('flags fewer than three viable approaches, naming each one and its note', () => {
    // No bridge (drawbridge, ram out) and no catapult (breach out): two approaches remain.
    const report = validateBattleMap(withoutBridge(map.layout), map.castle, rulesWithoutCatapult(), map.forestCoverage);
    expect(report.viable.length).toBeLessThan(MIN_VIABLE);
    expect(report.ok).toBe(false);
    const problem = report.problems.find((p) => p.startsWith(`only ${report.viable.length} viable approaches`));
    expect(problem).toBeDefined();
    for (const a of ASSAULT_APPROACHES) expect(problem).toContain(`${a}: `);
    expect(problem).toContain('pas de catapulte');
  }, HEAVY_TIMEOUT_MS);

  it('flags a forest coverage out of range, without the cost of the approaches when there is no deployment zone', () => {
    const noZone: WorldLayout = { ...map.layout, deployment: undefined };
    const report = validateBattleMap(noZone, map.castle, DEFAULT_RULES, 0.9);
    expect(report.ok).toBe(false);
    expect(report.viable).toEqual([]);
    expect(report.problems).toContain('no deployment zone');
    expect(report.problems.some((p) => p.startsWith('forest coverage'))).toBe(true);
  });
});
