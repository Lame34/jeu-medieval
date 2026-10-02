/**
 * src/core/worldgen/battle.ts (generateBattleMap) and validate-map.ts (validateBattleMap).
 *
 * generateBattleMap builds a full 512x512m map (relief, river, roads, castle, village, fields,
 * forest, vegetation) and takes ~3.5s per call. To keep this file fast we call it exactly THREE
 * times total, in a single `beforeAll`, and share the three results across every `it` below:
 *   - mapA1, mapA2: same seed, used for the determinism check.
 *   - mapB: a different seed, used for the divergence check.
 * Every other assertion (bounds, castle structures, houses, forest coverage, validateBattleMap
 * on a real map, ...) reads from mapA1. Failure cases for validateBattleMap are constructed
 * synthetically (bad forestCoverage / no deployment) instead of generating more maps.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateBattleMap, BATTLE_MAP_CELLS, PLAYABLE_MARGIN_M, type BattleMapParams, type GeneratedMap } from '@core/worldgen/battle.ts';
import { validateBattleMap, FOREST_COVERAGE_RANGE, type MapReport } from '@core/worldgen/validate-map.ts';
import { projectOnPolyline } from '@core/worldgen/geometry.ts';
import type { WorldLayout } from '@core/worldgen/types.ts';
import type { Vec2 } from '@core/math/vec2.ts';
import { TerrainLayer } from '@core/rules/types.ts';
import { layerAt } from '@core/terrain-data/terrain-data.ts';
import { hashValue } from '@core/math/hash.ts';
import { DEFAULT_RULES } from '@data/index.ts';

/** Fixed castle index for every fixture: keeps tower count / scale comparable across seeds. */
const CASTLE_INDEX: BattleMapParams['castleIndex'] = 2;
const SEED_A = 'worldgen-battle-fixture-a';
const SEED_B = 'worldgen-battle-fixture-b';
/** Observed ~3.5s per 512x512 generation; 3 calls comfortably fit under this. */
const HEAVY_TIMEOUT_MS = 60_000;
/** Village houses alone are 8-15 (brief); with farms added we only assert the lower bound. */
const MIN_HOUSES = 8;
const MIN_VIABLE_APPROACHES = 3;
const OUT_OF_RANGE_FOREST_COVERAGE = 0.05;

let mapA1: GeneratedMap;
let mapA2: GeneratedMap;
let mapB: GeneratedMap;
let reportA1: MapReport;

beforeAll(() => {
  mapA1 = generateBattleMap({ seed: SEED_A, castleIndex: CASTLE_INDEX });
  mapA2 = generateBattleMap({ seed: SEED_A, castleIndex: CASTLE_INDEX });
  mapB = generateBattleMap({ seed: SEED_B, castleIndex: CASTLE_INDEX });
  reportA1 = validateBattleMap(mapA1.layout, mapA1.castle, DEFAULT_RULES, mapA1.forestCoverage);
}, HEAVY_TIMEOUT_MS);

describe('generateBattleMap: determinism', () => {
  it('the same seed produces identical layer and height hashes', () => {
    expect(hashValue(mapA1.layout.terrain.layers)).toBe(hashValue(mapA2.layout.terrain.layers));
    expect(hashValue(mapA1.layout.terrain.heights)).toBe(hashValue(mapA2.layout.terrain.heights));
  });

  it('a different seed changes both the layers and the heights', () => {
    expect(hashValue(mapA1.layout.terrain.layers)).not.toBe(hashValue(mapB.layout.terrain.layers));
    expect(hashValue(mapA1.layout.terrain.heights)).not.toBe(hashValue(mapB.layout.terrain.heights));
  });
});

describe('generateBattleMap: playable bounds', () => {
  it('is a 512x512m map with a 6m decorative margin around the playable area', () => {
    expect(mapA1.layout.terrain.width).toBe(BATTLE_MAP_CELLS);
    expect(mapA1.layout.terrain.depth).toBe(BATTLE_MAP_CELLS);
    expect(mapA1.layout.playable).toEqual({
      minX: PLAYABLE_MARGIN_M,
      minZ: PLAYABLE_MARGIN_M,
      maxX: BATTLE_MAP_CELLS - PLAYABLE_MARGIN_M,
      maxZ: BATTLE_MAP_CELLS - PLAYABLE_MARGIN_M,
    });
  });
});

describe('generateBattleMap: deployment zone', () => {
  it('is a non-degenerate rectangle inside the map, south of the castle', () => {
    const deploy = mapA1.layout.deployment;
    expect(deploy).toBeDefined();
    if (!deploy) return;
    expect(deploy.minX).toBeLessThan(deploy.maxX);
    expect(deploy.minZ).toBeLessThan(deploy.maxZ);
    expect(deploy.minX).toBeGreaterThanOrEqual(0);
    expect(deploy.maxX).toBeLessThanOrEqual(BATTLE_MAP_CELLS);
    expect(deploy.maxZ).toBeLessThanOrEqual(BATTLE_MAP_CELLS);
    const castleCenterZ = mapA1.castle.ring.reduce((s, p) => s + p.z, 0) / mapA1.castle.ring.length;
    expect(deploy.minZ).toBeGreaterThan(castleCenterZ); // deployment sits well south of the castle
  });

  it('places every attacker unit marker inside the deployment zone, siege engines excepted', () => {
    const deploy = mapA1.layout.deployment;
    expect(deploy).toBeDefined();
    if (!deploy) return;
    const attackers = mapA1.layout.units.filter((u) => u.faction === 'attacker' && !u.id.startsWith('att-siege-'));
    expect(attackers.length).toBeGreaterThan(0);
    for (const u of attackers) {
      expect(u.position.x).toBeGreaterThanOrEqual(deploy.minX);
      expect(u.position.x).toBeLessThanOrEqual(deploy.maxX);
      expect(u.position.z).toBeGreaterThanOrEqual(deploy.minZ);
      expect(u.position.z).toBeLessThanOrEqual(deploy.maxZ);
    }
  });

  it('parks the siege engines (J4) on the approach road, beyond the tower archers yet within catapult range', () => {
    const engines = mapA1.layout.units.filter((u) => u.id.startsWith('att-siege-'));
    expect(engines.map((u) => u.typeKey).sort()).toEqual(['catapult', 'ram']);
    const gate = mapA1.castle.gate.center;
    const road = mapA1.layout.roads.find((r) => r.id === 'road-main');
    expect(road).toBeDefined();
    for (const u of engines) {
      const d = Math.hypot(u.position.x - gate.x, u.position.z - gate.z);
      expect(d).toBeGreaterThan(50);
      expect(d).toBeLessThan(75);
      expect(projectOnPolyline(u.position, road?.centerline ?? []).distance).toBeLessThan(10);
    }
  });
});

describe('generateBattleMap: castle structures', () => {
  it('has 3-8 curtain towers (round) plus exactly 2 square gate towers', () => {
    const round = mapA1.layout.towers.filter((t) => t.shape === 'round');
    const gateTowers = mapA1.layout.towers.filter((t) => t.shape === 'square');
    expect(round.length).toBeGreaterThanOrEqual(3);
    expect(round.length).toBeLessThanOrEqual(8);
    expect(gateTowers).toHaveLength(2);
    expect(mapA1.layout.towers).toHaveLength(round.length + 2);
  });

  it('has exactly one gate and one keep', () => {
    expect(mapA1.layout.gates).toHaveLength(1);
    expect(mapA1.layout.keeps).toHaveLength(1);
  });
});

describe('generateBattleMap: water', () => {
  it('includes both a river and the castle moat', () => {
    expect(mapA1.layout.water.map((w) => w.kind).sort()).toEqual(['moat', 'river']);
  });

  it('spans the river with exactly one bridge', () => {
    expect(mapA1.layout.bridges).toHaveLength(1);
    expect(mapA1.layout.bridges[0]?.widthM).toBeGreaterThan(0);
  });
});

describe('generateBattleMap: houses', () => {
  it('places at least 8 houses (village + farms)', () => {
    expect(mapA1.layout.houses.length).toBeGreaterThanOrEqual(MIN_HOUSES);
  });

  it('never sits a house on a Road/River/Moat/Wall cell (every house stands on Building)', () => {
    const forbidden = new Set<number>([TerrainLayer.Road, TerrainLayer.River, TerrainLayer.Moat, TerrainLayer.Wall]);
    for (const h of mapA1.layout.houses) {
      const layer = layerAt(mapA1.layout.terrain, Math.floor(h.center.x), Math.floor(h.center.z));
      expect(forbidden.has(layer)).toBe(false);
      expect(layer).toBe(TerrainLayer.Building);
    }
  });
});

describe('generateBattleMap: forest', () => {
  it('covers between 25% and 35% of the playable area', () => {
    expect(mapA1.forestCoverage).toBeGreaterThanOrEqual(FOREST_COVERAGE_RANGE[0]);
    expect(mapA1.forestCoverage).toBeLessThanOrEqual(FOREST_COVERAGE_RANGE[1]);
  });

  it('only keeps trees standing on Forest, Plain or Hedge cells', () => {
    const allowed = new Set<number>([TerrainLayer.Forest, TerrainLayer.Plain, TerrainLayer.Hedge]);
    expect(mapA1.layout.trees.length).toBeGreaterThan(0);
    for (const tree of mapA1.layout.trees) {
      const layer = layerAt(mapA1.layout.terrain, Math.floor(tree.position.x), Math.floor(tree.position.z));
      expect(allowed.has(layer)).toBe(true);
    }
  });
});

describe('validateBattleMap: the generated map', () => {
  it('validates ok with at least 3 viable assault approaches', () => {
    expect(reportA1.problems).toEqual([]);
    expect(reportA1.ok).toBe(true);
    expect(reportA1.viable.length).toBeGreaterThanOrEqual(MIN_VIABLE_APPROACHES);
  });
});

describe('validateBattleMap: synthetic failure cases', () => {
  // Both calls below still run buildNavGrid (and, for the first, the full reachability floods)
  // over the real 512x512 map, which is comfortably fast uninstrumented but can cross the
  // default 5s per-test budget under v8 coverage instrumentation: give them a generous timeout.
  it(
    'flags an out-of-range forest coverage as a problem',
    () => {
      const report = validateBattleMap(mapA1.layout, mapA1.castle, DEFAULT_RULES, OUT_OF_RANGE_FOREST_COVERAGE);
      expect(report.ok).toBe(false);
      expect(report.problems.some((p) => p.includes('forest coverage'))).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'reports ok=false with no viable approaches when the layout has no deployment zone',
    () => {
      const layoutNoDeploy: WorldLayout = { ...mapA1.layout, deployment: undefined };
      const report = validateBattleMap(layoutNoDeploy, mapA1.castle, DEFAULT_RULES, mapA1.forestCoverage);
      expect(report.ok).toBe(false);
      expect(report.viable).toEqual([]);
      expect(report.problems).toContain('no deployment zone');
    },
    HEAVY_TIMEOUT_MS,
  );
});

describe('castle plan sanity (from the generated map, no extra generation)', () => {
  it('the gateApproach point lies outside the moat water body', () => {
    const moat = mapA1.castle.moat;
    const d = projectOnPolyline(mapA1.castle.gateApproach, moat.centerline as Vec2[]).distance;
    expect(d).toBeGreaterThan(moat.widthM / 2);
  });
});
