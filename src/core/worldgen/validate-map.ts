/**
 * Battle map validator (brief §9.12 step 7): deployment zone usable, at least three of the five
 * assault approaches viable — judged with the siege rules from where the attackers start
 * (battle/approaches.ts) — forest coverage in range, no forest hugging the walls (readability).
 */
import { ASSAULT_APPROACHES, viableApproaches, type AssaultApproach } from '../battle/approaches.ts';
import type { GameRules } from '../rules/types.ts';
import { TerrainLayer } from '../rules/types.ts';
import type { CastlePlan } from './castle.ts';
import type { WorldLayout } from './types.ts';

export const FOREST_COVERAGE_RANGE = [0.25, 0.35] as const;
const WALL_FOREST_CLEAR_M = 25;
/** The brief guarantees at least this many viable approaches on every map. */
const MIN_VIABLE_APPROACHES = 3;

export { ASSAULT_APPROACHES, type AssaultApproach };

export interface MapReport {
  readonly ok: boolean;
  readonly forestCoverage: number;
  readonly viable: readonly AssaultApproach[];
  readonly problems: readonly string[];
}

export function validateBattleMap(layout: WorldLayout, castle: CastlePlan, rules: GameRules, forestCoverage: number): MapReport {
  const problems: string[] = [];
  const t = layout.terrain;
  if (forestCoverage < FOREST_COVERAGE_RANGE[0] || forestCoverage > FOREST_COVERAGE_RANGE[1]) {
    problems.push(`forest coverage ${(forestCoverage * 100).toFixed(1)} % outside 25–35 %`);
  }
  if (!layout.deployment) return { ok: false, forestCoverage, viable: [], problems: [...problems, 'no deployment zone'] };
  const { viable, notes } = viableApproaches(layout, rules);
  if (viable.length < MIN_VIABLE_APPROACHES) problems.push(`only ${viable.length} viable approaches (${ASSAULT_APPROACHES.map((x) => `${x}: ${notes[x]}`).join('; ')})`);

  // Readability: no forest cell within WALL_FOREST_CLEAR_M of any wall point.
  const wallPoints = castle.walls.flatMap((w) => w.points);
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
