/**
 * A* on the navigation grid (8-connected, no corner cutting), bounded Dijkstra for movement
 * areas, and cost-preserving path smoothing. Edge costs are exactly the canonical
 * `segmentCost` between neighbouring cell centres, so every number shown to the player
 * (area contours, path cost preview, AP spent) comes from the same metric.
 */
import type { Vec2 } from '../math/vec2.ts';
import type { MovementProfile } from '../rules/types.ts';
import { CellHeap } from './binary-heap.ts';
import { IMPASSABLE, segmentCost, type NavGrid } from './nav-grid.ts';

/** Tolerance when comparing AP costs (float accumulation). */
export const AP_EPSILON = 1e-6;

const NEIGHBOR_DX = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const NEIGHBOR_DZ = [0, 0, 1, -1, 1, -1, 1, -1] as const;
const ORTHOGONAL_NEIGHBORS = 4;
const DIAGONAL_NEIGHBORS = 8;

export type BlockedPredicate = (index: number) => boolean;

/** Reusable scratch buffers: one per NavGrid, never shared between concurrent queries. */
export interface PathContext {
  readonly nav: NavGrid;
  readonly g: Float64Array;
  readonly parent: Int32Array;
  readonly seen: Uint32Array;
  readonly closed: Uint32Array;
  readonly heap: CellHeap;
  generation: number;
}

export function createPathContext(nav: NavGrid): PathContext {
  const count = nav.width * nav.depth;
  return {
    nav,
    g: new Float64Array(count),
    parent: new Int32Array(count),
    seen: new Uint32Array(count),
    closed: new Uint32Array(count),
    heap: new CellHeap(),
    generation: 0,
  };
}

export function nextGeneration(ctx: PathContext): number {
  ctx.generation = (ctx.generation + 1) >>> 0;
  if (ctx.generation === 0) {
    ctx.seen.fill(0);
    ctx.closed.fill(0);
    ctx.generation = 1;
  }
  ctx.heap.clear();
  return ctx.generation;
}

/**
 * AP cost of moving from cell (cx, cz) to its neighbour (cx + dx, cz + dz), identical to
 * `segmentCost` between the two centres. IMPASSABLE if blocked or corner-cutting.
 */
export function edgeCost(nav: NavGrid, profile: MovementProfile, cx: number, cz: number, dx: number, dz: number, blocked?: BlockedPredicate): number {
  const nx = cx + dx;
  const nz = cz + dz;
  if (nx < 0 || nz < 0 || nx >= nav.width || nz >= nav.depth) return IMPASSABLE;
  const costs = nav.apPerMeter[profile];
  const w = nav.width;
  const from = cz * w + cx;
  const to = nz * w + nx;
  const costFrom = costs[from] as number;
  const costTo = costs[to] as number;
  if (costFrom === IMPASSABLE || costTo === IMPASSABLE || blocked?.(to)) return IMPASSABLE;
  if (dx !== 0 && dz !== 0) {
    const sideA = cz * w + nx;
    const sideB = nz * w + cx;
    if ((costs[sideA] as number) === IMPASSABLE || (costs[sideB] as number) === IMPASSABLE) return IMPASSABLE;
    if (blocked && (blocked(sideA) || blocked(sideB))) return IMPASSABLE;
  }
  // Same arithmetic as segmentCost: two half pieces, heights sampled at t = 0, 0.5, 1
  // (read from the precomputed samples, which were produced by the same sampleHeight calls).
  const lengthM = dx !== 0 && dz !== 0 ? nav.diagonalLengthM : nav.orthogonalLengthM;
  const halfM = 0.5 * lengthM;
  const h0 = nav.sampledCenter[from] as number;
  const h1 = nav.sampledCenter[to] as number;
  let hm: number;
  if (dz === 0) hm = nav.sampledEastMid[dx > 0 ? from : to] as number;
  else if (dx === 0) hm = nav.sampledSouthMid[dz > 0 ? from : to] as number;
  else hm = nav.sampledCorner[Math.max(cz, nz) * (w + 1) + Math.max(cx, nx)] as number;
  const up0 = hm > h0 ? (hm - h0) / halfM : 0;
  const up1 = h1 > hm ? (h1 - hm) / halfM : 0;
  return halfM * costFrom * (1 + nav.uphillPenaltyPerGrade * up0) + halfM * costTo * (1 + nav.uphillPenaltyPerGrade * up1);
}

function octile(dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  return Math.max(ax, az) + (Math.SQRT2 - 1) * Math.min(ax, az);
}

export interface PathQuery {
  readonly profile: MovementProfile;
  readonly start: number;
  readonly goal: number;
  readonly blocked?: BlockedPredicate;
  /** Abort early when the best possible cost exceeds this budget. */
  readonly maxCost?: number;
}

export interface GridPath {
  /** Cell indices from start to goal inclusive. */
  readonly cells: readonly number[];
  /** AP cost along the cell chain. */
  readonly cost: number;
}

export function findPath(ctx: PathContext, query: PathQuery): GridPath | null {
  const { nav } = ctx;
  const { profile, start, goal, blocked } = query;
  const maxCost = query.maxCost ?? IMPASSABLE;
  const w = nav.width;
  const count = w * nav.depth;
  if (start < 0 || goal < 0 || start >= count || goal >= count) return null;
  const costs = nav.apPerMeter[profile];
  if ((costs[start] as number) === IMPASSABLE || (costs[goal] as number) === IMPASSABLE || blocked?.(goal)) return null;
  if (start === goal) return { cells: [start], cost: 0 };

  const gen = nextGeneration(ctx);
  const heuristicScale = nav.minApPerMeter[profile] * nav.cellSize;
  const gx = goal % w;
  const gz = Math.floor(goal / w);
  const heuristic = (i: number): number => octile((i % w) - gx, Math.floor(i / w) - gz) * heuristicScale;

  ctx.g[start] = 0;
  ctx.parent[start] = -1;
  ctx.seen[start] = gen;
  ctx.heap.push(start, heuristic(start), heuristic(start));

  while (ctx.heap.size > 0) {
    const current = ctx.heap.pop();
    if (ctx.closed[current] === gen) continue;
    ctx.closed[current] = gen;
    const gCurrent = ctx.g[current] as number;
    if (current === goal) {
      // The goal pops with its optimal cost: over budget means no path within the budget.
      return gCurrent > maxCost + AP_EPSILON ? null : { cells: reconstruct(ctx, goal), cost: gCurrent };
    }
    if (gCurrent + heuristic(current) > maxCost + AP_EPSILON) return null;
    const cx = current % w;
    const cz = Math.floor(current / w);
    for (let n = 0; n < DIAGONAL_NEIGHBORS; n++) {
      const dx = NEIGHBOR_DX[n] as number;
      const dz = NEIGHBOR_DZ[n] as number;
      const step = edgeCost(nav, profile, cx, cz, dx, dz, blocked);
      if (step === IMPASSABLE) continue;
      const next = (cz + dz) * w + (cx + dx);
      if (ctx.closed[next] === gen) continue;
      const tentative = gCurrent + step;
      if (ctx.seen[next] !== gen || tentative < (ctx.g[next] as number)) {
        ctx.seen[next] = gen;
        ctx.g[next] = tentative;
        ctx.parent[next] = current;
        const h = heuristic(next);
        ctx.heap.push(next, tentative + h, h);
      }
    }
  }
  return null;
}

function reconstruct(ctx: PathContext, goal: number): number[] {
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = ctx.parent[c] as number) cells.push(c);
  return cells.reverse();
}

export interface SmoothedPath {
  readonly waypoints: readonly Vec2[];
  /** Canonical AP cost of the polyline (never above the raw grid path cost). */
  readonly cost: number;
}

function center(nav: NavGrid, index: number): Vec2 {
  const cs = nav.cellSize;
  return { x: ((index % nav.width) + 0.5) * cs, z: (Math.floor(index / nav.width) + 0.5) * cs };
}

/**
 * Greedy string pulling: from each anchor, jump to the farthest later cell whose straight
 * segment is walkable AND not more expensive than following the grid path. Keeps the path
 * natural (no zig-zag) without ever cutting through forest to "save" distance at higher cost.
 */
export function smoothPath(nav: NavGrid, profile: MovementProfile, cells: readonly number[], blocked?: BlockedPredicate): SmoothedPath {
  if (cells.length === 0) return { waypoints: [], cost: 0 };
  const points = cells.map((c) => center(nav, c));
  // prefix[i] = grid cost from cells[0] to cells[i] using the canonical edge metric.
  const prefix = new Float64Array(cells.length);
  for (let i = 1; i < cells.length; i++) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    prefix[i] = (prefix[i - 1] as number) + segmentCost(nav, profile, a.x, a.z, b.x, b.z, blocked);
  }
  const waypoints: Vec2[] = [points[0] as Vec2];
  let total = 0;
  let anchor = 0;
  while (anchor < cells.length - 1) {
    let best = anchor + 1;
    let bestCost = (prefix[best] as number) - (prefix[anchor] as number);
    const a = points[anchor] as Vec2;
    for (let j = cells.length - 1; j > anchor + 1; j--) {
      const b = points[j] as Vec2;
      const direct = segmentCost(nav, profile, a.x, a.z, b.x, b.z, blocked);
      if (direct <= (prefix[j] as number) - (prefix[anchor] as number) + AP_EPSILON) {
        best = j;
        bestCost = direct;
        break;
      }
    }
    waypoints.push(points[best] as Vec2);
    total += bestCost;
    anchor = best;
  }
  return { waypoints, cost: total };
}

export { ORTHOGONAL_NEIGHBORS, DIAGONAL_NEIGHBORS, NEIGHBOR_DX, NEIGHBOR_DZ };
