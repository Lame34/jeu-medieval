/**
 * Static, per-battle data derived from the map: never serialised, rebuilt from the seed.
 * Keeping it out of BattleState keeps saves tiny and replays exact. The navigation grid follows
 * the castle structures (breaches, open gate, lowered drawbridge): syncNav (structures.ts) points
 * `nav` and `paths` at the grid of the current state.
 */
import { buildNavGrid, type NavGrid } from '../nav-grid/nav-grid.ts';
import { createPathContext, type PathContext } from '../nav-grid/pathfinding.ts';
import type { GameRules } from '../rules/types.ts';
import type { TerrainData } from '../terrain-data/terrain-data.ts';
import type { StructureDef } from './structures.ts';
import type { StructureState } from './types.ts';

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
  /** The map's relief and layers (structures intact). */
  readonly terrain: TerrainData;
  /** Grid of the current structures (syncNav). */
  nav: NavGrid;
  paths: PathContext;
  readonly structures: readonly StructureDef[];
  readonly baseTerrain: TerrainData;
  readonly baseDeck: Float32Array;
  /** Broken-structure signature of `nav`, and the grids already built. */
  navKey: string;
  readonly navCache: Map<string, { readonly nav: NavGrid; readonly paths: PathContext }>;
  /** The structures array `nav` was last synced to (states share it until a structure changes). */
  navFor: readonly StructureState[] | null;
}

/**
 * `deck`: per-cell deck elevation (wall-walks, tower tops, stairs), from the map
 * (WorldLayout.deck); none on open maps. `structures`: the castle's breakable parts.
 */
export function createBattleContext(terrain: TerrainData, rules: GameRules, deck?: Float32Array, structures: readonly StructureDef[] = []): BattleContext {
  const baseDeck = deck ?? new Float32Array(terrain.width * terrain.depth);
  const nav = buildNavGrid(terrain, rules, baseDeck);
  const paths = createPathContext(nav);
  return { rules, terrain, nav, paths, structures, baseTerrain: terrain, baseDeck, navKey: '', navCache: new Map([['', { nav, paths }]]), navFor: null };
}
