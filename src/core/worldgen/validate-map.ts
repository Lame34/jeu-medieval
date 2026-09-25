/**
 * Battle map validator (brief §9.12 step 7): deployment zone usable, castle reachable, at least
 * three of the five assault approaches viable, forest coverage in range, no forest hugging the
 * walls (readability).
 */
import type { Vec2 } from '../math/vec2.ts';
import { buildNavGrid, IMPASSABLE, type NavGrid } from '../nav-grid/nav-grid.ts';
import { createPathContext } from '../nav-grid/pathfinding.ts';
import { computeReachable, reachableCostAt } from '../nav-grid/reachable.ts';
import type { GameRules, MovementProfile } from '../rules/types.ts';
import { TerrainLayer } from '../rules/types.ts';
import { projectOnPolyline } from './geometry.ts';
import type { CastlePlan } from './castle.ts';
import type { WorldLayout } from './types.ts';

export const FOREST_COVERAGE_RANGE = [0.25, 0.35] as const;
const UNBOUNDED_AP = 1e9;
const CATAPULT_RANGE_M = 70;
const MOAT_EDGE_REACH_M = 3;
const WALL_FOREST_CLEAR_M = 25;

export const ASSAULT_APPROACHES = ['drawbridge', 'ram', 'breach', 'sap', 'siegeTower'] as const;
export type AssaultApproach = (typeof ASSAULT_APPROACHES)[number];

export interface MapReport {
  readonly ok: boolean;
  readonly forestCoverage: number;
  readonly viable: readonly AssaultApproach[];
  readonly problems: readonly string[];
}

function reachFrom(nav: NavGrid, profile: MovementProfile, origin: Vec2) {
  const ctx = createPathContext(nav);
  const index = Math.floor(origin.z) * nav.width + Math.floor(origin.x);
  return computeReachable(ctx, { profile, origin: index, budget: UNBOUNDED_AP });
}

/** Any reachable cell satisfying `pred` (scanned over the reached window). */
function anyReached(field: ReturnType<typeof reachFrom>, pred: (x: number, z: number) => boolean): boolean {
  for (let lz = 0; lz < field.depth; lz++) {
    for (let lx = 0; lx < field.width; lx++) {
      if ((field.cost[lz * field.width + lx] as number) === IMPASSABLE) continue;
      const x = field.minCx + lx + 0.5;
      const z = field.minCz + lz + 0.5;
      if (pred(x, z)) return true;
    }
  }
  return false;
}

export function validateBattleMap(layout: WorldLayout, castle: CastlePlan, rules: GameRules, forestCoverage: number): MapReport {
  const problems: string[] = [];
  const nav = buildNavGrid(layout.terrain, rules);
  const t = layout.terrain;
  if (forestCoverage < FOREST_COVERAGE_RANGE[0] || forestCoverage > FOREST_COVERAGE_RANGE[1]) {
    problems.push(`forest coverage ${(forestCoverage * 100).toFixed(1)} % outside 25–35 %`);
  }
  const deploy = layout.deployment;
  if (!deploy) return { ok: false, forestCoverage, viable: [], problems: [...problems, 'no deployment zone'] };
  const deployCenter = { x: (deploy.minX + deploy.maxX) / 2, z: (deploy.minZ + deploy.maxZ) / 2 };
  const foot = reachFrom(nav, 'foot', deployCenter);
  const light = reachFrom(nav, 'lightFoot', deployCenter);
  const engine = reachFrom(nav, 'engine', deployCenter);
  const gateCell = Math.floor(castle.gateApproach.z) * nav.width + Math.floor(castle.gateApproach.x);

  const moatLine = castle.moat.centerline;
  const moatHalf = castle.moat.widthM / 2;
  const center = centerOf(castle.ring);
  const ringMean = castle.ring.reduce((s, p) => s + Math.hypot(p.x - center.x, p.z - center.z), 0) / castle.ring.length;
  const distToCenter = (x: number, z: number) => Math.hypot(x - center.x, z - center.z);
  /** Outer bank of the moat (where fascines are thrown and siege towers stop). */
  const nearMoatOuter = (x: number, z: number) => {
    const d = projectOnPolyline({ x, z }, moatLine).distance;
    return d > moatHalf && d < moatHalf + MOAT_EDGE_REACH_M && distToCenter(x, z) > ringMean;
  };
  const wallPoints = castle.walls.flatMap((w) => w.points);
  const inCatapultRange = (x: number, z: number) =>
    distToCenter(x, z) > ringMean + moatHalf * 2 && wallPoints.some((p) => Math.hypot(p.x - x, p.z - z) <= CATAPULT_RANGE_M);

  const viable: AssaultApproach[] = [];
  if (reachableCostAt(foot, nav.width, gateCell) < IMPASSABLE) viable.push('drawbridge');
  if (reachableCostAt(engine, nav.width, gateCell) < IMPASSABLE) viable.push('ram');
  if (anyReached(engine, inCatapultRange)) viable.push('breach');
  if (anyReached(light, nearMoatOuter)) viable.push('sap');
  if (anyReached(engine, nearMoatOuter)) viable.push('siegeTower');
  if (viable.length < 3) problems.push(`only ${viable.length} viable approaches (${viable.join(', ')})`);

  // Readability: no forest cell within WALL_FOREST_CLEAR_M of any wall point.
  for (let cz = 0; cz < t.depth; cz += 2) {
    for (let cx = 0; cx < t.width; cx += 2) {
      if (t.layers[cz * t.width + cx] !== TerrainLayer.Forest) continue;
      if (wallPoints.some((p) => Math.hypot(p.x - cx, p.z - cz) < WALL_FOREST_CLEAR_M)) {
        problems.push('forest too close to the walls');
        cz = t.depth;
        break;
      }
    }
  }
  return { ok: problems.length === 0, forestCoverage, viable, problems };
}

function centerOf(points: readonly Vec2[]): Vec2 {
  const x = points.reduce((s, p) => s + p.x, 0) / points.length;
  const z = points.reduce((s, p) => s + p.z, 0) / points.length;
  return { x, z };
}
