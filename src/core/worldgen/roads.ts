/**
 * Road routing (brief §9.12 step 3): A* on a coarse grid over the relief. Roads prefer gentle
 * slopes and avoid water except at designated crossings, then get smoothed into natural curves.
 */
import type { Vec2 } from '../math/vec2.ts';
import { CellHeap } from '../nav-grid/binary-heap.ts';
import { sampleHeight, type TerrainData } from '../terrain-data/terrain-data.ts';
import { catmullRom } from './geometry.ts';

export interface RoadCostOptions {
  /** Coarse routing grid step (m). */
  readonly stepM: number;
  /** Cost multiplier per unit of squared grade. */
  readonly slopePenalty: number;
  /** Extra cost at a point (Infinity = impassable), e.g. water outside crossings. */
  readonly extraCost: (x: number, z: number) => number;
}

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const SMOOTH_DECIMATION = 3;
const SMOOTH_SAMPLES = 6;

/** Returns a smoothed road centreline from `from` to `to`, or null when no route exists. */
export function routeRoad(t: TerrainData, from: Vec2, to: Vec2, options: RoadCostOptions): Vec2[] | null {
  const step = options.stepM;
  const cols = Math.floor((t.width * t.cellSize) / step) + 1;
  const rows = Math.floor((t.depth * t.cellSize) / step) + 1;
  const toNode = (p: Vec2) => Math.min(rows - 1, Math.max(0, Math.round(p.z / step))) * cols + Math.min(cols - 1, Math.max(0, Math.round(p.x / step)));
  const nodeX = (n: number) => (n % cols) * step;
  const nodeZ = (n: number) => Math.floor(n / cols) * step;
  const height = new Float64Array(cols * rows);
  for (let n = 0; n < height.length; n++) height[n] = sampleHeight(t, nodeX(n), nodeZ(n));

  const start = toNode(from);
  const goal = toNode(to);
  const g = new Float64Array(cols * rows).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const heap = new CellHeap();
  const gx = nodeX(goal);
  const gz = nodeZ(goal);
  const h = (n: number) => Math.hypot(nodeX(n) - gx, nodeZ(n) - gz);
  g[start] = 0;
  heap.push(start, h(start), 0);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % cols;
    const cz = Math.floor(cur / cols);
    for (const [dx, dz] of NEIGHBORS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const next = nz * cols + nx;
      if (closed[next]) continue;
      const extra = options.extraCost(nodeX(next), nodeZ(next));
      if (extra === Number.POSITIVE_INFINITY) continue;
      const dist = step * Math.hypot(dx, dz);
      const grade = ((height[next] as number) - (height[cur] as number)) / dist;
      const cost = dist * (1 + options.slopePenalty * grade * grade) + extra;
      const tentative = (g[cur] as number) + cost;
      if (tentative < (g[next] as number)) {
        g[next] = tentative;
        parent[next] = cur;
        heap.push(next, tentative + h(next), 0);
      }
    }
  }
  if (!closed[goal]) return null;
  const nodes: number[] = [];
  for (let n = goal; n !== -1; n = parent[n] as number) nodes.push(n);
  nodes.reverse();
  const coarse = nodes.filter((_, i) => i % SMOOTH_DECIMATION === 0 || i === nodes.length - 1).map((n) => ({ x: nodeX(n), z: nodeZ(n) }));
  coarse[0] = from;
  coarse[coarse.length - 1] = to;
  return catmullRom(coarse, SMOOTH_SAMPLES);
}
