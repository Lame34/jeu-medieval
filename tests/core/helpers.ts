/**
 * Shared fixtures for the core test suite: synthetic terrains and a slow, independent
 * reference search (plain Dijkstra, O(n^2)) used to check A-star / reachable results against.
 * Nothing here is imported by src/core: it only depends on the public core API.
 */
import {
  IMPASSABLE,
  NEIGHBOR_DX,
  NEIGHBOR_DZ,
  TerrainLayer,
  buildNavGrid,
  createTerrainData,
  edgeCost,
  setHeightAtCorner,
  setLayer,
  type BlockedPredicate,
  type MovementProfile,
  type NavGrid,
  type Rng,
  type Seed,
  type TerrainData,
  type TerrainLayerId,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';

/** Flat terrain (all corners at `height`), single layer everywhere. */
export function flatTerrain(width: number, depth: number, cellSize = 1, height = 0): TerrainData {
  const terrain = createTerrainData(width, depth, cellSize);
  terrain.heights.fill(height);
  return terrain;
}

/** Sets every cell of the inclusive rectangle [cx0..cx1] x [cz0..cz1] to `layer`. */
export function fillRect(t: TerrainData, cx0: number, cz0: number, cx1: number, cz1: number, layer: TerrainLayerId): void {
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) setLayer(t, cx, cz, layer);
  }
}

/** Overwrites every corner height with an exact plane h = base + gradeX*x + gradeZ*z (world metres). */
export function setPlaneHeights(t: TerrainData, gradeX: number, gradeZ: number, base = 0): void {
  for (let iz = 0; iz <= t.depth; iz++) {
    for (let ix = 0; ix <= t.width; ix++) {
      setHeightAtCorner(t, ix, iz, base + gradeX * ix * t.cellSize + gradeZ * iz * t.cellSize);
    }
  }
}

/** Builds a NavGrid for `t` using DEFAULT_RULES unless a rule set is supplied. */
export function buildNav(t: TerrainData, rules = DEFAULT_RULES): NavGrid {
  return buildNavGrid(t, rules);
}

/** A deterministic pool of walkable/blocking layers used by the random small-grid generators. */
const RANDOM_LAYER_POOL: readonly TerrainLayerId[] = [
  TerrainLayer.Plain,
  TerrainLayer.Plain,
  TerrainLayer.Plain,
  TerrainLayer.Road,
  TerrainLayer.Field,
  TerrainLayer.Forest,
  TerrainLayer.Mud,
  TerrainLayer.Wall,
  TerrainLayer.Rubble,
];

export interface RandomGridOptions {
  readonly minSize?: number;
  readonly maxSize?: number;
  readonly heightRange?: number;
}

/** Small terrain with random layers (mostly walkable, some Wall obstacles) and rough relief. */
export function randomTerrain(rng: Rng, opts: RandomGridOptions = {}): TerrainData {
  const minSize = opts.minSize ?? 4;
  const maxSize = opts.maxSize ?? 7;
  const heightRange = opts.heightRange ?? 0.6;
  const width = rng.int(minSize, maxSize);
  const depth = rng.int(minSize, maxSize);
  const t = createTerrainData(width, depth, 1);
  for (let iz = 0; iz <= depth; iz++) {
    for (let ix = 0; ix <= width; ix++) setHeightAtCorner(t, ix, iz, rng.float(-heightRange, heightRange));
  }
  for (let cz = 0; cz < depth; cz++) {
    for (let cx = 0; cx < width; cx++) setLayer(t, cx, cz, rng.pick(RANDOM_LAYER_POOL));
  }
  return t;
}

export function randomNav(rng: Rng, opts: RandomGridOptions = {}): NavGrid {
  return buildNav(randomTerrain(rng, opts));
}

/** True when a cell is walkable at all for `profile` (finite AP/m). */
export function isCellPassable(nav: NavGrid, profile: MovementProfile, index: number): boolean {
  return (nav.apPerMeter[profile][index] as number) < IMPASSABLE;
}

/** Picks a passable cell index deterministically from `rng`, retrying until one is found. */
export function pickPassableCell(rng: Rng, nav: NavGrid, profile: MovementProfile, maxAttempts = 500): number | null {
  const count = nav.width * nav.depth;
  for (let i = 0; i < maxAttempts; i++) {
    const index = rng.int(0, count - 1);
    if (isCellPassable(nav, profile, index)) return index;
  }
  return null;
}

/**
 * Plain O(n^2) Dijkstra written independently of the A* implementation in src/core, used as a
 * slow reference oracle. It still calls `edgeCost` (the same primitive `findPath` uses) rather
 * than re-deriving the AP-cost formula: that formula (uphill penalty, corner-cutting, diagonal
 * cost) is checked separately in nav-grid.test.ts by comparing `edgeCost` to `segmentCost`. This
 * Dijkstra only re-checks the *search* (optimality, tie handling, reachability), on a plain
 * unguided algorithm, independent of A*'s heuristic and open/closed-set bookkeeping.
 */
export function referenceDijkstra(
  nav: NavGrid,
  profile: MovementProfile,
  start: number,
  goal: number,
  blocked?: BlockedPredicate,
): number {
  const count = nav.width * nav.depth;
  const dist = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const done = new Uint8Array(count);
  dist[start] = 0;
  for (;;) {
    let u = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      if (!done[i] && (dist[i] as number) < best) {
        best = dist[i] as number;
        u = i;
      }
    }
    if (u === -1 || u === goal) break;
    done[u] = 1;
    const cx = u % nav.width;
    const cz = Math.floor(u / nav.width);
    for (let n = 0; n < NEIGHBOR_DX.length; n++) {
      const dx = NEIGHBOR_DX[n] as number;
      const dz = NEIGHBOR_DZ[n] as number;
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= nav.width || nz >= nav.depth) continue;
      const v = nz * nav.width + nx;
      if (done[v]) continue;
      const w = edgeCost(nav, profile, cx, cz, dx, dz, blocked);
      if (w === IMPASSABLE) continue;
      const alt = (dist[u] as number) + w;
      if (alt < (dist[v] as number)) dist[v] = alt;
    }
  }
  return dist[goal] as number;
}

/** Fixed seeds named for readability at call sites instead of bare literals. */
export const SEEDS = {
  rngBasic: 'test-rng-basic',
  rngFork: 'test-rng-fork',
  noise: 'test-noise-seed',
  pathfindingFuzz: 'test-pathfinding-fuzz',
  reachableFuzz: 'test-reachable-fuzz',
  edgeCostFuzz: 'test-edge-cost-fuzz',
  determinism: 'test-determinism-e2e',
} as const satisfies Record<string, Seed>;
