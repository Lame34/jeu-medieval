/** Blue-noise scattering (Bridson Poisson disk) with a variable-density acceptance mask. */
import type { Vec2 } from '../math/vec2.ts';
import type { Rng } from '../rng.ts';

const CANDIDATES_PER_POINT = 24;

export interface ScatterBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/**
 * Poisson-disk samples at least `minDistance` apart. `density(p)` in [0, 1] is the probability
 * of keeping a candidate: dense forest cores, sparse edges, empty clearings.
 */
export function poissonScatter(rng: Rng, bounds: ScatterBounds, minDistance: number, density: (p: Vec2) => number): Vec2[] {
  const cell = minDistance / Math.SQRT2;
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
  const grid = new Int32Array(cols * rows).fill(-1);
  const all: Vec2[] = [];
  const active: number[] = [];
  const kept: Vec2[] = [];

  const gridIndex = (p: Vec2) => {
    const cx = Math.min(cols - 1, Math.floor((p.x - bounds.minX) / cell));
    const cz = Math.min(rows - 1, Math.floor((p.z - bounds.minZ) / cell));
    return cz * cols + cx;
  };
  const farEnough = (p: Vec2) => {
    const cx = Math.floor((p.x - bounds.minX) / cell);
    const cz = Math.floor((p.z - bounds.minZ) / cell);
    for (let z = Math.max(0, cz - 2); z <= Math.min(rows - 1, cz + 2); z++) {
      for (let x = Math.max(0, cx - 2); x <= Math.min(cols - 1, cx + 2); x++) {
        const idx = grid[z * cols + x] as number;
        if (idx >= 0) {
          const q = all[idx] as Vec2;
          if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < minDistance * minDistance) return false;
        }
      }
    }
    return true;
  };
  const add = (p: Vec2) => {
    all.push(p);
    grid[gridIndex(p)] = all.length - 1;
    active.push(all.length - 1);
    if (rng.next() < density(p)) kept.push(p);
  };

  add({ x: rng.float(bounds.minX, bounds.maxX), z: rng.float(bounds.minZ, bounds.maxZ) });
  while (active.length > 0) {
    const slot = rng.int(0, active.length - 1);
    const origin = all[active[slot] as number] as Vec2;
    let placed = false;
    for (let k = 0; k < CANDIDATES_PER_POINT; k++) {
      const angle = rng.next() * 2 * Math.PI;
      const radius = minDistance * (1 + rng.next());
      const p = { x: origin.x + Math.cos(angle) * radius, z: origin.z + Math.sin(angle) * radius };
      if (p.x < bounds.minX || p.z < bounds.minZ || p.x >= bounds.maxX || p.z >= bounds.maxZ) continue;
      if (!farEnough(p)) continue;
      add(p);
      placed = true;
      break;
    }
    if (!placed) {
      active[slot] = active[active.length - 1] as number;
      active.pop();
    }
  }
  return kept;
}
