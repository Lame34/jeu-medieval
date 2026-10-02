/**
 * Castle structures (J4, brief §9.8): curtain-wall segments that can be breached, the gate and its
 * portcullis (the passage opens when both are down), the drawbridge (it falls when its winch
 * operator dies). Definitions come from the map; the battle state carries HP and broken flags.
 *
 * The navigation grid is a pure function of the map and of which structures are broken: a
 * breached segment turns to walkable rubble at ground level, an open gatehouse to road, a lowered
 * drawbridge to a bridge deck at bank height. syncNav rebuilds (and caches) the grid for a state,
 * so a replay meets exactly the same grids.
 */
import type { Vec2 } from '../math/vec2.ts';
import { buildNavGrid } from '../nav-grid/nav-grid.ts';
import { createPathContext } from '../nav-grid/pathfinding.ts';
import { TerrainLayer, type ArmorClass, type StructureRules } from '../rules/types.ts';
import { cellCenterHeight, type TerrainData } from '../terrain-data/terrain-data.ts';
import { crossingCells, liftHingeM, liftTipM, passageCells } from '../worldgen/gatehouse.ts';
import type { WorldLayout } from '../worldgen/types.ts';
import type { BattleContext } from './context.ts';
import { fillCells, fillSurfaceM, FILL_SITE_PREFIX } from './moat.ts';
import type { StructureState, WorkState } from './types.ts';

export type StructureKind = 'wall' | 'gate' | 'portcullis' | 'drawbridge';

export interface StructureDef {
  readonly id: string;
  readonly kind: StructureKind;
  readonly material: ArmorClass;
  /** 0: cannot be attacked (the drawbridge falls with its operator). */
  readonly maxHp: number;
  /** Cells it occupies: wall-walk cells of a segment, the gate passage, moat cells under the drawbridge. */
  readonly cells: readonly number[];
  readonly center: Vec2;
  /** Gate, portcullis and drawbridge: the gatehouse they belong to. */
  readonly gateId?: string;
  /** Drawbridge: the defender whose death lowers it. */
  readonly operatorId?: string;
  /** Drawbridge: height (m) of its deck, level with the gate sill. */
  readonly deckHeightM?: number;
}

/** Segment-to-cell assignment margin (m). */
const WALL_CELL_MARGIN_M = 0.5;

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/** Cells within `radius` of segment ab, of `layer`. */
function cellsNear(t: TerrainData, a: Vec2, b: Vec2, radius: number, layer: number): number[] {
  const out: number[] = [];
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius));
  const maxX = Math.min(t.width - 1, Math.ceil(Math.max(a.x, b.x) + radius));
  const minZ = Math.max(0, Math.floor(Math.min(a.z, b.z) - radius));
  const maxZ = Math.min(t.depth - 1, Math.ceil(Math.max(a.z, b.z) + radius));
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const i = cz * t.width + cx;
      if (t.layers[i] !== layer) continue;
      if (distanceToSegment({ x: cx + 0.5, z: cz + 0.5 }, a, b) <= radius) out.push(i);
    }
  }
  return out;
}

function centerOf(t: TerrainData, cells: readonly number[], fallback: Vec2): Vec2 {
  if (cells.length === 0) return fallback;
  let x = 0;
  let z = 0;
  for (const i of cells) {
    x += (i % t.width) + 0.5;
    z += Math.floor(i / t.width) + 0.5;
  }
  return { x: x / cells.length, z: z / cells.length };
}

/** Structure definitions of a map (none on open maps). HP come from the rules. */
export function planStructures(layout: WorldLayout, hp: Pick<StructureRules, 'wallHp' | 'gateHp' | 'portcullisHp'>): StructureDef[] {
  const t = layout.terrain;
  const defs: StructureDef[] = [];
  // Curtain segments: each wall-walk cell goes to its nearest segment (towers stay whole).
  const towerCells = new Set<number>();
  for (const tower of layout.towers) {
    for (const i of cellsNear(t, tower.center, tower.center, tower.radiusM, TerrainLayer.Rampart)) towerCells.add(i);
  }
  const segments: { id: string; a: Vec2; b: Vec2; reach: number }[] = [];
  for (const w of layout.walls) {
    for (let k = 0; k < w.points.length - 1; k++) segments.push({ id: wallSegmentId(w.id, k), a: w.points[k] as Vec2, b: w.points[k + 1] as Vec2, reach: w.thicknessM / 2 + WALL_CELL_MARGIN_M });
  }
  const cellsOf = new Map<string, number[]>(segments.map((s) => [s.id, []]));
  for (const s of segments) {
    for (const i of cellsNear(t, s.a, s.b, s.reach, TerrainLayer.Rampart)) {
      if (towerCells.has(i)) continue;
      const p = { x: (i % t.width) + 0.5, z: Math.floor(i / t.width) + 0.5 };
      const nearest = segments.reduce((best, o) => (distanceToSegment(p, o.a, o.b) < distanceToSegment(p, best.a, best.b) ? o : best), s);
      if (nearest.id === s.id) cellsOf.get(s.id)?.push(i);
    }
  }
  for (const s of segments) {
    const cells = cellsOf.get(s.id) ?? [];
    if (cells.length > 0) defs.push({ id: s.id, kind: 'wall', material: 'stone', maxHp: hp.wallHp, cells, center: centerOf(t, cells, s.a) });
  }
  for (const gate of layout.gates) {
    const passage = passageCells(t, gate);
    defs.push({ id: gateStructureId('gate', gate.id), kind: 'gate', material: 'wood', maxHp: hp.gateHp, cells: passage, center: gate.center, gateId: gate.id });
    defs.push({ id: gateStructureId('portcullis', gate.id), kind: 'portcullis', material: 'heavy', maxHp: hp.portcullisHp, cells: passage, center: gate.center, gateId: gate.id });
    if (gate.drawbridge && gate.crossingEndM !== undefined) {
      // The lifting span, one cell onto the fixed bridge so that the two meet.
      const under = crossingCells(t, gate, liftHingeM(), liftTipM() + t.cellSize);
      defs.push({
        id: gateStructureId('drawbridge', gate.id),
        kind: 'drawbridge',
        material: 'wood',
        maxHp: 0,
        cells: under,
        center: centerOf(t, under, gate.center),
        gateId: gate.id,
        ...(gate.winchOperatorId ? { operatorId: gate.winchOperatorId } : {}),
        deckHeightM: gate.baseHeightM,
      });
    }
  }
  return defs.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Id of the structure for segment `k` of wall run `wallId` (from points[k] to points[k + 1]). */
export function wallSegmentId(wallId: string, k: number): string {
  return `wall:${wallId}:${k}`;
}

/** Id of a gatehouse structure. */
export function gateStructureId(kind: 'gate' | 'portcullis' | 'drawbridge', gateId: string): string {
  return `${kind}:${gateId}`;
}

export function initialStructures(defs: readonly StructureDef[]): StructureState[] {
  return defs.map((d) => ({ id: d.id, hp: d.maxHp, broken: false }));
}

export function structureDef(ctx: BattleContext, id: string): StructureDef | undefined {
  return ctx.structures.find((d) => d.id === id);
}

export function isBroken(structures: readonly StructureState[], id: string): boolean {
  return structures.find((s) => s.id === id)?.broken ?? false;
}

/** No works yet (a stable empty list: states share it). */
export const NO_WORKS: readonly WorkState[] = Object.freeze([]);

/** What changes the ground — broken structures, filled moat slots — the key of the navigation grids. */
export function navSignature(structures: readonly StructureState[], works: readonly WorkState[] = NO_WORKS): string {
  const parts = structures.filter((s) => s.broken).map((s) => s.id);
  for (const w of works) if (w.done && w.id.startsWith(FILL_SITE_PREFIX)) parts.push(w.id);
  return parts.join('|');
}

/** Layers and decks of the ground once `structures` and `works` are applied to the map. */
function groundFor(ctx: BattleContext, structures: readonly StructureState[], works: readonly WorkState[]): { terrain: TerrainData; deck: Float32Array } {
  const base = ctx.baseTerrain;
  const layers = new Uint8Array(base.layers);
  const deck = new Float32Array(ctx.baseDeck);
  // Fascine causeways across the moat, level just under the sill.
  for (const w of works) {
    if (!w.done || !w.id.startsWith(FILL_SITE_PREFIX)) continue;
    const surface = fillSurfaceM(ctx, w.id);
    for (const i of fillCells(ctx, w.id)) {
      layers[i] = TerrainLayer.Fascine;
      deck[i] = Math.max(0, surface - cellCenterHeight(base, i % base.width, Math.floor(i / base.width)));
    }
  }
  for (const def of ctx.structures) {
    if (!isBroken(structures, def.id)) continue;
    if (def.kind === 'wall') {
      // Collapsed into rubble at ground level.
      for (const i of def.cells) {
        layers[i] = TerrainLayer.Rubble;
        deck[i] = 0;
      }
    } else if (def.kind === 'drawbridge') {
      // Lowered: a deck level with the gate sill across the moat.
      for (const i of def.cells) {
        layers[i] = TerrainLayer.Bridge;
        deck[i] = Math.max(0, (def.deckHeightM ?? 0) - cellCenterHeight(base, i % base.width, Math.floor(i / base.width)));
      }
    } else {
      // The passage opens when the gate and the portcullis behind it are both down.
      const barriers = ctx.structures.filter((d) => d.gateId === def.gateId && (d.kind === 'gate' || d.kind === 'portcullis'));
      if (!barriers.every((d) => isBroken(structures, d.id))) continue;
      for (const i of def.cells) {
        layers[i] = TerrainLayer.Road;
        deck[i] = 0;
      }
    }
  }
  return { terrain: { ...base, layers }, deck };
}

/** Points the context's navigation grid at the one matching `structures` and `works` (built once, then cached). */
export function syncNav(ctx: BattleContext, structures: readonly StructureState[], works: readonly WorkState[] = NO_WORKS): void {
  if (ctx.navFor === structures && ctx.navForWorks === works) return;
  const key = navSignature(structures, works);
  if (key !== ctx.navKey) {
    let entry = ctx.navCache.get(key);
    if (!entry) {
      const ground = groundFor(ctx, structures, works);
      const nav = buildNavGrid(ground.terrain, ctx.rules, ground.deck);
      entry = { nav, paths: createPathContext(nav) };
      ctx.navCache.set(key, entry);
    }
    ctx.nav = entry.nav;
    ctx.paths = entry.paths;
    ctx.navKey = key;
  }
  ctx.navFor = structures;
  ctx.navForWorks = works;
}
