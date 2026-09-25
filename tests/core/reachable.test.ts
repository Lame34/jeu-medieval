import { describe, expect, it } from 'vitest';
import {
  AP_EPSILON,
  IMPASSABLE,
  Rng,
  TerrainLayer,
  computeReachable,
  createPathContext,
  findPath,
  reachableCostAt,
  type MovementProfile,
} from '@core/index.ts';
import { buildNav, fillRect, flatTerrain, pickPassableCell, randomNav, SEEDS } from './helpers.ts';

const FOOT: MovementProfile = 'foot';

describe('computeReachable', () => {
  it('every reached cell costs <= budget, and matches the A* cost to that same cell', () => {
    const rng = Rng.create(SEEDS.reachableFuzz);
    const TRIALS = 30;
    let checkedCells = 0;
    for (let trial = 0; trial < TRIALS; trial++) {
      const nav = randomNav(rng, { minSize: 5, maxSize: 8 });
      const origin = pickPassableCell(rng, nav, FOOT);
      if (origin === null) continue;
      const budget = rng.float(1, 4);
      const ctx = createPathContext(nav);
      const field = computeReachable(ctx, { profile: FOOT, origin, budget });

      for (let lz = 0; lz < field.depth; lz++) {
        for (let lx = 0; lx < field.width; lx++) {
          const cost = field.cost[lz * field.width + lx] as number;
          if (cost === IMPASSABLE) continue;
          expect(cost).toBeLessThanOrEqual(budget + AP_EPSILON);
          const cx = field.minCx + lx;
          const cz = field.minCz + lz;
          const goal = cz * nav.width + cx;
          const found = findPath(ctx, { profile: FOOT, start: origin, goal });
          expect(found).not.toBeNull();
          expect(Math.abs((found?.cost as number) - cost)).toBeLessThan(1e-6);
          checkedCells++;
        }
      }
    }
    expect(checkedCells).toBeGreaterThan(0);
  });

  it('cells beyond the budget are IMPASSABLE in the field, and only the origin fits a near-zero budget', () => {
    const nav = buildNav(flatTerrain(8, 8, 1)); // all Plain: foot edge cost ~= 0.1667 AP/cell
    const origin = 0;
    const ctx = createPathContext(nav);
    const tinyBudget = 0.01; // smaller than the cost of a single step
    const field = computeReachable(ctx, { profile: FOOT, origin, budget: tinyBudget });
    let reachedCount = 0;
    for (const c of field.cost) if ((c as number) !== IMPASSABLE) reachedCount++;
    expect(reachedCount).toBe(1); // only the origin (cost 0) fits the budget
    // The far corner is well outside both the budget and the resulting window.
    const farIndex = (nav.depth - 1) * nav.width + (nav.width - 1);
    expect(reachableCostAt(field, nav.width, farIndex)).toBe(IMPASSABLE);
  });

  it('reachableCostAt returns IMPASSABLE for an index outside the window', () => {
    const nav = buildNav(flatTerrain(8, 8, 1));
    const origin = nav.width * nav.depth - 1; // bottom-right corner
    const ctx = createPathContext(nav);
    const field = computeReachable(ctx, { profile: FOOT, origin, budget: 0.5 });
    // The opposite corner (top-left) is guaranteed outside a small window near the bottom-right.
    expect(reachableCostAt(field, nav.width, 0)).toBe(IMPASSABLE);
  });

  it('an impassable origin reaches nothing', () => {
    const t = flatTerrain(4, 4, 1);
    fillRect(t, 1, 1, 1, 1, TerrainLayer.Wall);
    const nav = buildNav(t);
    const origin = 1 * 4 + 1; // the Wall cell
    const ctx = createPathContext(nav);
    const field = computeReachable(ctx, { profile: FOOT, origin, budget: 5 });
    for (const c of field.cost) expect(c).toBe(IMPASSABLE);
  });
});
