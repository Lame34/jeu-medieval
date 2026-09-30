/**
 * Static, per-battle data derived from the map: never serialised, rebuilt from the seed.
 * Keeping it out of BattleState keeps saves tiny and replays exact.
 */
import { buildNavGrid, type NavGrid } from '../nav-grid/nav-grid.ts';
import { createPathContext, type PathContext } from '../nav-grid/pathfinding.ts';
import type { GameRules } from '../rules/types.ts';
import type { TerrainData } from '../terrain-data/terrain-data.ts';

/** Deck elevation (m above the relief) of the cell holding `p`. */
export function deckAt(ctx: BattleContext, p: { readonly x: number; readonly z: number }): number {
  const cs = ctx.nav.cellSize;
  const cx = Math.floor(p.x / cs);
  const cz = Math.floor(p.z / cs);
  if (cx < 0 || cz < 0 || cx >= ctx.nav.width || cz >= ctx.nav.depth) return 0;
  return ctx.nav.deck[cz * ctx.nav.width + cx] as number;
}

export interface BattleContext {
  readonly rules: GameRules;
  readonly terrain: TerrainData;
  readonly nav: NavGrid;
  readonly paths: PathContext;
}

/**
 * `deck`: per-cell deck elevation (wall-walks, tower tops, stairs), from the map
 * (WorldLayout.deck); none on open maps.
 */
export function createBattleContext(terrain: TerrainData, rules: GameRules, deck?: Float32Array): BattleContext {
  const nav = buildNavGrid(terrain, rules, deck);
  return { rules, terrain, nav, paths: createPathContext(nav) };
}
