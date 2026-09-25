/**
 * Static, per-battle data derived from the map: never serialised, rebuilt from the seed.
 * Keeping it out of BattleState keeps saves tiny and replays exact.
 */
import { buildNavGrid, type NavGrid } from '../nav-grid/nav-grid.ts';
import { createPathContext, type PathContext } from '../nav-grid/pathfinding.ts';
import type { GameRules } from '../rules/types.ts';
import type { TerrainData } from '../terrain-data/terrain-data.ts';

export interface BattleContext {
  readonly rules: GameRules;
  readonly terrain: TerrainData;
  readonly nav: NavGrid;
  readonly paths: PathContext;
}

export function createBattleContext(terrain: TerrainData, rules: GameRules): BattleContext {
  const nav = buildNavGrid(terrain, rules);
  return { rules, terrain, nav, paths: createPathContext(nav) };
}
