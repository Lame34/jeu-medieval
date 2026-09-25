/**
 * Line of sight: a ray from the shooter's eye to the target's centre of mass, traversed cell by
 * cell. Terrain relief blocks it; obstacles (forest, houses, walls, hedges) either block it
 * (opaque) or accumulate obscurance (foliage). The shooter's and target's own cells never
 * obstruct: standing inside a forest gives cover, it does not blind.
 */
import type { Vec2 } from '../math/vec2.ts';
import { sampleHeight } from '../terrain-data/terrain-data.ts';
import type { NavGrid } from './nav-grid.ts';
import { traverseSegment } from './traverse.ts';

/** Accumulated obscurance at which sight is considered fully blocked. */
export const OPAQUE_OBSCURANCE = 1;

export interface SightQuery {
  readonly from: Vec2;
  readonly to: Vec2;
  /** Eye height above the ground at `from` (m). */
  readonly eyeHeightM: number;
  /** Aim height above the ground at `to` (m). */
  readonly targetHeightM: number;
  /** Extra elevation of the shooter (rampart walkway, tower top…), in metres. */
  readonly fromElevationM?: number;
  readonly toElevationM?: number;
}

export type SightBlocker = 'terrain' | 'obstacle';

export interface SightResult {
  readonly visible: boolean;
  /** 0 = clear, 1 = fully obscured. */
  readonly obscurance: number;
  readonly blockedBy: SightBlocker | null;
}

export function lineOfSight(nav: NavGrid, query: SightQuery): SightResult {
  const { from, to } = query;
  const terrain = nav.terrain;
  const y0 = sampleHeight(terrain, from.x, from.z) + (query.fromElevationM ?? 0) + query.eyeHeightM;
  const y1 = sampleHeight(terrain, to.x, to.z) + (query.toElevationM ?? 0) + query.targetHeightM;
  const cs = nav.cellSize;
  const fromCx = Math.floor(from.x / cs);
  const fromCz = Math.floor(from.z / cs);
  const toCx = Math.floor(to.x / cs);
  const toCz = Math.floor(to.z / cs);
  const horizontalM = Math.hypot(to.x - from.x, to.z - from.z);
  let obscurance = 0;
  let blockedBy: SightBlocker | null = null;

  traverseSegment(nav, from.x, from.z, to.x, to.z, (cx, cz, t0, t1) => {
    if (cx < 0 || cz < 0 || cx >= nav.width || cz >= nav.depth) return true;
    const isEndpoint = (cx === fromCx && cz === fromCz) || (cx === toCx && cz === toCz);
    const i = cz * nav.width + cx;
    const obstacleH = isEndpoint ? 0 : (nav.sightHeight[i] as number);
    if (!isEndpoint) {
      for (const t of [t0, (t0 + t1) * 0.5, t1]) {
        const rayY = y0 + (y1 - y0) * t;
        const groundY = sampleHeight(terrain, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
        if (rayY < groundY) {
          blockedBy = 'terrain';
          return false;
        }
      }
    }
    if (obstacleH > 0) {
      const tm = (t0 + t1) * 0.5;
      const rayY = y0 + (y1 - y0) * tm;
      const groundY = sampleHeight(terrain, from.x + (to.x - from.x) * tm, from.z + (to.z - from.z) * tm);
      if (rayY < groundY + obstacleH) {
        obscurance += (nav.sightDensity[i] as number) * (t1 - t0) * horizontalM;
        if (obscurance >= OPAQUE_OBSCURANCE) {
          blockedBy = 'obstacle';
          return false;
        }
      }
    }
    return true;
  });

  const clamped = Math.min(obscurance, OPAQUE_OBSCURANCE);
  return { visible: blockedBy === null, obscurance: blockedBy === null ? clamped : OPAQUE_OBSCURANCE, blockedBy };
}
