/**
 * Micro-benchmark of the navigation core on a full-size 512 × 512 battle grid.
 * Budgets (plan J1): A* across the map < 5 ms, reachable field < 3 ms (median).
 * Usage: node scripts/core-bench.ts
 */
import { createBattleContext } from '../src/core/battle/context.ts';
import { createSimplex, fbm } from '../src/core/noise/noise.ts';
import { findPath } from '../src/core/nav-grid/pathfinding.ts';
import { computeReachable } from '../src/core/nav-grid/reachable.ts';
import { lineOfSight } from '../src/core/nav-grid/line-of-sight.ts';
import { Rng } from '../src/core/rng.ts';
import { TerrainLayer } from '../src/core/rules/types.ts';
import { createTerrainData, setHeightAtCorner, setLayer } from '../src/core/terrain-data/terrain-data.ts';
import { DEFAULT_RULES } from '../src/data/index.ts';

const GRID = 512;
const RELIEF_AMPLITUDE_M = 18;
const FOREST_THRESHOLD = 0.25;
const RUNS = 25;
const PATH_BUDGET_MS = 5;
const REACH_BUDGET_MS = 3;
const REACH_AP = 6;
/** Longest tactical move: 6 AP of cavalry on road ≈ 48 m. */
const TACTICAL_RADIUS = 48;
const TACTICAL_AP = 6;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const rng = Rng.create('core-bench');
const relief = createSimplex(rng.fork('relief'));
const forest = createSimplex(rng.fork('forest'));
const terrain = createTerrainData(GRID, GRID);
for (let z = 0; z <= GRID; z++) {
  for (let x = 0; x <= GRID; x++) setHeightAtCorner(terrain, x, z, fbm(relief, x, z) * RELIEF_AMPLITUDE_M);
}
for (let z = 0; z < GRID; z++) {
  for (let x = 0; x < GRID; x++) {
    if (fbm(forest, x, z) > FOREST_THRESHOLD) setLayer(terrain, x, z, TerrainLayer.Forest);
  }
}

const tBuild = performance.now();
const ctx = createBattleContext(terrain, DEFAULT_RULES);
const buildMs = performance.now() - tBuild;

const pathTimes: number[] = [];
const crossMapTimes: number[] = [];
const reachTimes: number[] = [];
let found = 0;
for (let i = 0; i < RUNS; i++) {
  const start = rng.int(0, GRID * GRID - 1);
  const sx = start % GRID;
  const sz = Math.floor(start / GRID);
  const gxLocal = Math.min(GRID - 1, Math.max(0, sx + rng.int(-TACTICAL_RADIUS, TACTICAL_RADIUS)));
  const gzLocal = Math.min(GRID - 1, Math.max(0, sz + rng.int(-TACTICAL_RADIUS, TACTICAL_RADIUS)));
  let t = performance.now();
  if (findPath(ctx.paths, { profile: 'foot', start, goal: gzLocal * GRID + gxLocal, maxCost: TACTICAL_AP })) found++;
  pathTimes.push(performance.now() - t);
  t = performance.now();
  findPath(ctx.paths, { profile: 'foot', start, goal: rng.int(0, GRID * GRID - 1) });
  crossMapTimes.push(performance.now() - t);
  t = performance.now();
  computeReachable(ctx.paths, { profile: 'mounted', origin: start, budget: REACH_AP });
  reachTimes.push(performance.now() - t);
}
const t = performance.now();
const sight = lineOfSight(ctx.nav, { from: { x: 10.5, z: 10.5 }, to: { x: 400.5, z: 380.5 }, eyeHeightM: 1.6, targetHeightM: 1.2 });
const losMs = performance.now() - t;

const pathMedian = median(pathTimes);
const reachMedian = median(reachTimes);
console.log(`navgrid build: ${buildMs.toFixed(1)} ms`);
console.log(`A* tactical (≤ ${TACTICAL_RADIUS} m, ${TACTICAL_AP} AP): median ${pathMedian.toFixed(2)} ms, max ${Math.max(...pathTimes).toFixed(2)} ms, found ${found}/${RUNS}`);
console.log(`A* cross-map (AI, informative): median ${median(crossMapTimes).toFixed(2)} ms, max ${Math.max(...crossMapTimes).toFixed(2)} ms`);
console.log(`reachable field (${REACH_AP} AP, mounted): median ${reachMedian.toFixed(2)} ms`);
console.log(`line of sight (560 m): ${losMs.toFixed(3)} ms → visible=${sight.visible} obscurance=${sight.obscurance.toFixed(2)} blockedBy=${sight.blockedBy}`);
const ok = pathMedian < PATH_BUDGET_MS && reachMedian < REACH_BUDGET_MS;
console.log(ok ? 'BUDGETS OK' : 'BUDGETS EXCEEDED');
process.exitCode = ok ? 0 : 1;
