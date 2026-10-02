/**
 * Bounded Dijkstra from a unit's cell: the AP cost to every cell reachable within a budget.
 * The result is a compact window (bounding box of reached cells) that the renderer turns into
 * a distance-field texture for the two painted movement contours.
 */
import type { MovementProfile } from '../rules/types.ts';
import { IMPASSABLE } from './nav-grid.ts';
import {
  AP_EPSILON,
  DIAGONAL_NEIGHBORS,
  NEIGHBOR_DX,
  NEIGHBOR_DZ,
  connectedComponents,
  edgeCost,
  nextGeneration,
  type BlockedPredicate,
  type PathContext,
} from './pathfinding.ts';

export interface ReachableField {
  readonly profile: MovementProfile;
  readonly origin: number;
  readonly budget: number;
  /** Window origin and size in cells (inclusive bounding box of reached cells). */
  readonly minCx: number;
  readonly minCz: number;
  readonly width: number;
  readonly depth: number;
  /** AP cost per window cell; IMPASSABLE when not reachable within budget. */
  readonly cost: Float32Array;
}

export interface ReachableQuery {
  readonly profile: MovementProfile;
  readonly origin: number;
  readonly budget: number;
  readonly blocked?: BlockedPredicate;
}

export function computeReachable(ctx: PathContext, query: ReachableQuery): ReachableField {
  const { nav } = ctx;
  const { profile, origin, budget, blocked } = query;
  const w = nav.width;
  const gen = nextGeneration(ctx);

  const reached: number[] = [];
  let minCx = origin % w;
  let maxCx = minCx;
  let minCz = Math.floor(origin / w);
  let maxCz = minCz;

  if ((nav.apPerMeter[profile][origin] as number) !== IMPASSABLE) {
    ctx.g[origin] = 0;
    ctx.seen[origin] = gen;
    ctx.heap.push(origin, 0, 0);
  }

  while (ctx.heap.size > 0) {
    const current = ctx.heap.pop();
    if (ctx.closed[current] === gen) continue;
    ctx.closed[current] = gen;
    reached.push(current);
    const cx = current % w;
    const cz = Math.floor(current / w);
    if (cx < minCx) minCx = cx;
    if (cx > maxCx) maxCx = cx;
    if (cz < minCz) minCz = cz;
    if (cz > maxCz) maxCz = cz;
    const gCurrent = ctx.g[current] as number;
    for (let n = 0; n < DIAGONAL_NEIGHBORS; n++) {
      const dx = NEIGHBOR_DX[n] as number;
      const dz = NEIGHBOR_DZ[n] as number;
      const step = edgeCost(nav, profile, cx, cz, dx, dz, blocked);
      if (step === IMPASSABLE) continue;
      const tentative = gCurrent + step;
      if (tentative > budget + AP_EPSILON) continue;
      const next = (cz + dz) * w + (cx + dx);
      if (ctx.closed[next] === gen) continue;
      if (ctx.seen[next] !== gen || tentative < (ctx.g[next] as number)) {
        ctx.seen[next] = gen;
        ctx.g[next] = tentative;
        ctx.heap.push(next, tentative, 0);
      }
    }
  }

  const width = maxCx - minCx + 1;
  const depth = maxCz - minCz + 1;
  const cost = new Float32Array(width * depth).fill(IMPASSABLE);
  for (const cell of reached) {
    const lx = (cell % w) - minCx;
    const lz = Math.floor(cell / w) - minCz;
    cost[lz * width + lx] = ctx.g[cell] as number;
  }
  return { profile, origin, budget, minCx, minCz, width, depth, cost };
}

/** Where a cost field may stop early: once these cells are settled, `slackAp` further out. */
export interface FieldSettle {
  readonly cells: readonly number[];
  readonly slackAp: number;
}

/**
 * Multi-source Dijkstra over the grid: the AP cost from every cell to the nearest origin
 * (costs are accumulated outwards from the origins, so uphill and downhill swap: an estimate for
 * scoring, not an executable path). Impassable origins are skipped. Full-grid Float32Array,
 * IMPASSABLE where no origin is reachable within the budget.
 *
 * With `settle`, the search stops once every one of its cells that some origin can reach is
 * settled and the frontier is `slackAp` past the farthest: the field is exact up to there and
 * IMPASSABLE beyond (callers only read it around those cells).
 */
export function computeCostField(ctx: PathContext, profile: MovementProfile, origins: readonly number[], budget: number, settle?: FieldSettle): Float32Array {
  const { nav } = ctx;
  const w = nav.width;
  const gen = nextGeneration(ctx);
  const field = new Float32Array(nav.width * nav.depth).fill(IMPASSABLE);
  for (const origin of origins) {
    if ((nav.apPerMeter[profile][origin] as number) === IMPASSABLE || ctx.seen[origin] === gen) continue;
    ctx.g[origin] = 0;
    ctx.seen[origin] = gen;
    ctx.heap.push(origin, 0, 0);
  }
  let pending: Set<number> | null = null;
  let limit = budget;
  if (settle) {
    const label = connectedComponents(ctx, profile);
    const reached = new Set<number>();
    for (const origin of origins) if ((label[origin] as number) >= 0) reached.add(label[origin] as number);
    pending = new Set(settle.cells.filter((c) => reached.has(label[c] as number)));
    if (pending.size === 0) limit = -1;
  }
  while (ctx.heap.size > 0) {
    const current = ctx.heap.pop();
    if (ctx.closed[current] === gen) continue;
    const gCurrent = ctx.g[current] as number;
    if (gCurrent > limit) break;
    ctx.closed[current] = gen;
    field[current] = gCurrent;
    // Our cells settle in cost order: the last one is the farthest.
    if (pending?.delete(current) && pending.size === 0) limit = Math.min(budget, gCurrent + (settle as FieldSettle).slackAp);
    const cx = current % w;
    const cz = Math.floor(current / w);
    for (let n = 0; n < DIAGONAL_NEIGHBORS; n++) {
      const dx = NEIGHBOR_DX[n] as number;
      const dz = NEIGHBOR_DZ[n] as number;
      const step = edgeCost(nav, profile, cx, cz, dx, dz);
      if (step === IMPASSABLE) continue;
      const tentative = gCurrent + step;
      if (tentative > budget) continue;
      const next = (cz + dz) * w + (cx + dx);
      if (ctx.closed[next] === gen) continue;
      if (ctx.seen[next] !== gen || tentative < (ctx.g[next] as number)) {
        ctx.seen[next] = gen;
        ctx.g[next] = tentative;
        ctx.heap.push(next, tentative, 0);
      }
    }
  }
  return field;
}

/** AP cost to reach a global cell index, or IMPASSABLE. */
export function reachableCostAt(field: ReachableField, gridWidth: number, index: number): number {
  const lx = (index % gridWidth) - field.minCx;
  const lz = Math.floor(index / gridWidth) - field.minCz;
  if (lx < 0 || lz < 0 || lx >= field.width || lz >= field.depth) return IMPASSABLE;
  return field.cost[lz * field.width + lx] as number;
}
