import { describe, expect, it } from 'vitest';
import {
  IMPASSABLE,
  Rng,
  TerrainLayer,
  cellCenter,
  createPathContext,
  edgeCost,
  findPath,
  segmentCost,
  setHeightAtCorner,
  smoothPath,
  type MovementProfile,
  type TerrainData,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { buildNav, fillRect, flatTerrain, pickPassableCell, randomNav, referenceDijkstra, SEEDS } from './helpers.ts';

const FOOT: MovementProfile = 'foot';
const COST_TOLERANCE = 1e-6;

describe('findPath vs a plain-Dijkstra reference, on random small grids', () => {
  it('matches the reference cost on >= 200 random small grids with obstacles and relief', () => {
    const rng = Rng.create(SEEDS.pathfindingFuzz);
    const TRIALS = 220;
    let reachableTrials = 0;
    let unreachableTrials = 0;
    for (let trial = 0; trial < TRIALS; trial++) {
      const nav = randomNav(rng);
      const start = pickPassableCell(rng, nav, FOOT);
      const goal = pickPassableCell(rng, nav, FOOT);
      if (start === null || goal === null) continue;
      const ctx = createPathContext(nav);
      const found = findPath(ctx, { profile: FOOT, start, goal });
      const reference = referenceDijkstra(nav, FOOT, start, goal);
      if (Number.isFinite(reference)) {
        reachableTrials++;
        expect(found).not.toBeNull();
        expect(Math.abs((found?.cost as number) - reference)).toBeLessThan(COST_TOLERANCE);
        expect(found?.cells[0]).toBe(start);
        expect(found?.cells[found.cells.length - 1]).toBe(goal);
      } else {
        unreachableTrials++;
        expect(found).toBeNull();
      }
    }
    // Sanity: the fuzz actually exercised both a reachable and an unreachable case at least once.
    expect(reachableTrials).toBeGreaterThan(0);
    expect(unreachableTrials).toBeGreaterThan(0);
  });

  it('a sufficient maxCost (>= optimal cost) always still finds the optimal path', () => {
    // Note: only the "sufficient budget" direction is fuzzed here. The opposite direction
    // ("maxCost below the optimal cost => null") is NOT reliably true — see the dedicated
    // bug report in the "findPath: maxCost is not always enforced" block below.
    const rng = Rng.create('pathfinding-maxcost');
    const TRIALS = 60;
    let checked = 0;
    for (let trial = 0; trial < TRIALS; trial++) {
      const nav = randomNav(rng);
      const start = pickPassableCell(rng, nav, FOOT);
      const goal = pickPassableCell(rng, nav, FOOT);
      if (start === null || goal === null || start === goal) continue;
      const reference = referenceDijkstra(nav, FOOT, start, goal);
      if (!Number.isFinite(reference)) continue;
      const ctx = createPathContext(nav);
      const justEnough = findPath(ctx, { profile: FOOT, start, goal, maxCost: reference + COST_TOLERANCE });
      expect(justEnough).not.toBeNull();
      expect(Math.abs((justEnough?.cost as number) - reference)).toBeLessThan(COST_TOLERANCE);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('findPath: maxCost is not always enforced (core bug)', () => {
  // BUG: `findPath`'s early-abort check (`gCurrent + heuristic(current) > maxCost + AP_EPSILON`)
  // only runs for nodes popped from the open heap that are NOT the goal (see the `if (current
  // === goal) return ...` branch in src/core/nav-grid/pathfinding.ts, which returns *before* the
  // budget check). Because the A* heuristic is admissible but not slope-aware (it uses
  // `minApPerMeter`, the grid-wide cheapest AP/m, ignoring the uphill penalty entirely), a path
  // whose *last* edge is unexpectedly costly (e.g. a steep uphill step right next to the goal)
  // can be discovered and returned as the very first `current === goal` pop, with a real cost
  // that exceeds `maxCost` by an arbitrary amount. `movement.ts`'s `planMove` happens to be safe
  // from this because it re-checks `apSpentFor(smooth.cost) > unit.ap` after calling `findPath`,
  // but `findPath` itself does not honour its own documented contract ("abort early when the
  // best possible cost exceeds this budget") for the goal node, so any other caller that trusts
  // "non-null => cost <= maxCost" (as `movement.ts`'s null/non-null branching implies it should)
  // can be misled.
  //
  // Minimal repro: a 2x1 flat "Plain" strip (foot: 6 m/AP) with a 0.6 m step between the two
  // cells (grade 0.6, well under foot's 0.9 max walkable grade, so still passable). The flat-
  // distance heuristic estimates ~0.1667 AP for the single hop, but the real uphill-penalised
  // edge costs ~0.2917 AP. Any maxCost in [0.1667, 0.2917) should yield `null` (the destination
  // is not reachable within budget) but instead returns the full-cost path.
  // Fixed in findPath: the goal's optimal cost is now checked against maxCost when it pops.
  it('rejects a maxCost below the true (uphill-penalised) cost of the only path', () => {
    const t = flatTerrain(2, 1, 1);
    setHeightAtCorner(t, 1, 0, 0.6);
    setHeightAtCorner(t, 1, 1, 0.6);
    const nav = buildNav(t);
    expect(DEFAULT_RULES.movement.maxWalkableGrade.foot).toBeGreaterThan(0.6); // still walkable
    const trueCost = edgeCost(nav, FOOT, 0, 0, 1, 0);
    expect(trueCost).toBeGreaterThan(0.28); // ~0.2917: confirms the uphill penalty applied
    const ctx = createPathContext(nav);
    const budget = 0.2; // strictly less than trueCost, strictly more than the flat heuristic
    const result = findPath(ctx, { profile: FOOT, start: 0, goal: 1, maxCost: budget });
    // Documented/expected behaviour: no path fits in a 0.2 AP budget when the only edge costs
    // ~0.2917 AP, so this should be null.
    expect(result).toBeNull();
  });
});

describe('findPath: edge cases', () => {
  it('returns null when start or goal is out of range', () => {
    const nav = buildNav(flatTerrain(3, 3));
    const ctx = createPathContext(nav);
    expect(findPath(ctx, { profile: FOOT, start: -1, goal: 0 })).toBeNull();
    expect(findPath(ctx, { profile: FOOT, start: 0, goal: 100 })).toBeNull();
  });

  it('returns a zero-cost single-cell path when start === goal', () => {
    const nav = buildNav(flatTerrain(3, 3));
    const ctx = createPathContext(nav);
    const path = findPath(ctx, { profile: FOOT, start: 4, goal: 4 });
    expect(path).toEqual({ cells: [4], cost: 0 });
  });

  it('returns null when the goal cell itself is impassable', () => {
    const t = flatTerrain(3, 1, 1);
    fillRect(t, 2, 0, 2, 0, TerrainLayer.Wall);
    const nav = buildNav(t);
    const ctx = createPathContext(nav);
    expect(findPath(ctx, { profile: FOOT, start: 0, goal: 2 })).toBeNull();
  });

  it('returns null when a walled-off destination has no route at all', () => {
    const t = flatTerrain(3, 3, 1);
    fillRect(t, 0, 1, 2, 1, TerrainLayer.Wall); // a full wall row separates the grid in two
    const nav = buildNav(t);
    const ctx = createPathContext(nav);
    expect(findPath(ctx, { profile: FOOT, start: 0, goal: 7 })).toBeNull(); // (0,0) -> (1,2)
  });

  it('a `blocked` predicate forces a detour, matching the reference Dijkstra with the same predicate', () => {
    const t = flatTerrain(3, 3, 1);
    const nav = buildNav(t);
    const ctx = createPathContext(nav);
    const centerIndex = 1 * 3 + 1; // (1,1)
    const blocked = (index: number): boolean => index === centerIndex;
    const start = 0; // (0,0)
    const goal = 8; // (2,2)
    const found = findPath(ctx, { profile: FOOT, start, goal, blocked });
    const reference = referenceDijkstra(nav, FOOT, start, goal, blocked);
    expect(found).not.toBeNull();
    expect(Math.abs((found?.cost as number) - reference)).toBeLessThan(COST_TOLERANCE);
    expect(found?.cells).not.toContain(centerIndex);
  });
});

describe('findPath: rivers are impassable except at a ford or bridge', () => {
  function riverMap(): TerrainData {
    const width = 5;
    const depth = 3;
    const t = flatTerrain(width, depth, 1);
    fillRect(t, 0, 1, width - 1, 1, TerrainLayer.River); // the whole middle row is a river
    return t;
  }

  it('finds a path through a single ford cell in an otherwise impassable river', () => {
    const t = riverMap();
    fillRect(t, 2, 1, 2, 1, TerrainLayer.Ford);
    const nav = buildNav(t);
    const ctx = createPathContext(nav);
    const start = 2; // (2,0), north bank
    const goal = 2 + 2 * 5; // (2,2), south bank
    const found = findPath(ctx, { profile: FOOT, start, goal });
    expect(found).not.toBeNull();
    const fordIndex = 1 * 5 + 2;
    expect(found?.cells).toContain(fordIndex);
  });

  it('has no path at all when the river has no ford or bridge', () => {
    const t = riverMap(); // fully River, no gap
    const nav = buildNav(t);
    const ctx = createPathContext(nav);
    const start = 2;
    const goal = 2 + 2 * 5;
    expect(findPath(ctx, { profile: FOOT, start, goal })).toBeNull();
  });

  it('a bridge also opens a crossing', () => {
    const t = riverMap();
    fillRect(t, 3, 1, 3, 1, TerrainLayer.Bridge);
    const nav = buildNav(t);
    const ctx = createPathContext(nav);
    const start = 3;
    const goal = 3 + 2 * 5;
    const found = findPath(ctx, { profile: FOOT, start, goal });
    expect(found).not.toBeNull();
    expect(found?.cells).toContain(1 * 5 + 3);
  });
});

describe('smoothPath', () => {
  it('never costs more than the raw grid path (within a tiny tolerance)', () => {
    const rng = Rng.create('smooth-cost');
    for (let trial = 0; trial < 60; trial++) {
      const nav = randomNav(rng);
      const start = pickPassableCell(rng, nav, FOOT);
      const goal = pickPassableCell(rng, nav, FOOT);
      if (start === null || goal === null || start === goal) continue;
      const ctx = createPathContext(nav);
      const grid = findPath(ctx, { profile: FOOT, start, goal });
      if (!grid) continue;
      const smoothed = smoothPath(nav, FOOT, grid.cells);
      expect(smoothed.cost).toBeLessThanOrEqual(grid.cost + 1e-6);
    }
  });

  it('no smoothed segment ever crosses a blocked cell', () => {
    // A U-shaped wall forces the raw A* path to zig-zag; smoothing must not cut the corner
    // through the wall to "save" distance.
    const t = flatTerrain(7, 7, 1);
    fillRect(t, 2, 1, 2, 5, TerrainLayer.Wall);
    fillRect(t, 2, 5, 4, 5, TerrainLayer.Wall);
    fillRect(t, 4, 1, 4, 5, TerrainLayer.Wall);
    const nav = buildNav(t);
    const ctx = createPathContext(nav);
    const start = 1; // (1,0)
    const goal = 5; // (5,0), both outside the U, so the only way through is around the top
    const grid = findPath(ctx, { profile: FOOT, start, goal });
    expect(grid).not.toBeNull();
    const smoothed = smoothPath(nav, FOOT, grid?.cells as number[]);
    for (let i = 1; i < smoothed.waypoints.length; i++) {
      const a = smoothed.waypoints[i - 1];
      const b = smoothed.waypoints[i];
      if (!a || !b) continue;
      const segCost = segmentCost(nav, FOOT, a.x, a.z, b.x, b.z);
      expect(segCost).toBeLessThan(IMPASSABLE);
    }
  });

  it('first and last waypoints are exactly the start/goal cell centres', () => {
    const nav = buildNav(flatTerrain(6, 6, 1));
    const ctx = createPathContext(nav);
    const start = 0;
    const goal = 35;
    const grid = findPath(ctx, { profile: FOOT, start, goal });
    expect(grid).not.toBeNull();
    const smoothed = smoothPath(nav, FOOT, grid?.cells as number[]);
    expect(smoothed.waypoints[0]).toEqual(cellCenter(nav, 0, 0));
    expect(smoothed.waypoints[smoothed.waypoints.length - 1]).toEqual(cellCenter(nav, 5, 5));
  });

  it('an empty cell list yields an empty, zero-cost path', () => {
    const nav = buildNav(flatTerrain(3, 3, 1));
    expect(smoothPath(nav, FOOT, [])).toEqual({ waypoints: [], cost: 0 });
  });
});
