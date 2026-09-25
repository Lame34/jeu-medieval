/**
 * Invisible 1 m navigation grid derived from TerrainData + rules. Everything is precomputed
 * into typed arrays so path queries never allocate per cell.
 */
import { COVER_LEVELS, MOVEMENT_PROFILES, type CoverLevel, type GameRules, type MovementProfile } from '../rules/types.ts';
import { cellCenterHeight, cellGrade, sampleHeight, type TerrainData } from '../terrain-data/terrain-data.ts';
import { traverseSegment } from './traverse.ts';

export const IMPASSABLE = Number.POSITIVE_INFINITY;

export interface NavGrid {
  readonly terrain: TerrainData;
  readonly width: number;
  readonly depth: number;
  readonly cellSize: number;
  readonly uphillPenaltyPerGrade: number;
  /** Centre-to-centre distances, computed with Math.hypot exactly like segmentCost. */
  readonly orthogonalLengthM: number;
  readonly diagonalLengthM: number;
  /** Mean corner height per cell. */
  readonly centerHeight: Float32Array;
  /**
   * Heights precomputed with `sampleHeight` at the exact points `segmentCost` samples for
   * neighbour moves (cell centres, east/south edge midpoints, corners): edge costs are then
   * bit-identical to the canonical segment cost without resampling.
   */
  readonly sampledCenter: Float64Array;
  readonly sampledEastMid: Float64Array;
  readonly sampledSouthMid: Float64Array;
  /** (width + 1) × (depth + 1). */
  readonly sampledCorner: Float64Array;
  /** AP spent per metre inside the cell, per profile. IMPASSABLE when blocked (layer or slope). */
  readonly apPerMeter: Readonly<Record<MovementProfile, Float32Array>>;
  /** Cheapest AP/m over the whole grid, per profile (admissible A* heuristic). */
  readonly minApPerMeter: Readonly<Record<MovementProfile, number>>;
  /** Index into COVER_LEVELS. */
  readonly cover: Uint8Array;
  readonly directionalCover: Uint8Array;
  readonly flammable: Uint8Array;
  readonly sightHeight: Float32Array;
  readonly sightDensity: Float32Array;
}

export function buildNavGrid(terrain: TerrainData, rules: GameRules): NavGrid {
  const count = terrain.width * terrain.depth;
  const centerHeight = new Float32Array(count);
  const grade = new Float32Array(count);
  const cover = new Uint8Array(count);
  const directionalCover = new Uint8Array(count);
  const flammable = new Uint8Array(count);
  const sightHeight = new Float32Array(count);
  const sightDensity = new Float32Array(count);
  const cs = terrain.cellSize;
  const sampledCenter = new Float64Array(count);
  const sampledEastMid = new Float64Array(count);
  const sampledSouthMid = new Float64Array(count);
  const sampledCorner = new Float64Array((terrain.width + 1) * (terrain.depth + 1));
  for (let iz = 0; iz <= terrain.depth; iz++) {
    for (let ix = 0; ix <= terrain.width; ix++) sampledCorner[iz * (terrain.width + 1) + ix] = sampleHeight(terrain, ix * cs, iz * cs);
  }
  const apPerMeter = {} as Record<MovementProfile, Float32Array>;
  const minApPerMeter = {} as Record<MovementProfile, number>;
  for (const profile of MOVEMENT_PROFILES) {
    apPerMeter[profile] = new Float32Array(count);
    minApPerMeter[profile] = IMPASSABLE;
  }

  for (let cz = 0; cz < terrain.depth; cz++) {
    for (let cx = 0; cx < terrain.width; cx++) {
      const i = cz * terrain.width + cx;
      const layer = rules.terrainLayers[terrain.layers[i] as number];
      if (!layer) throw new RangeError(`buildNavGrid: unknown layer id ${terrain.layers[i]} at cell (${cx}, ${cz})`);
      centerHeight[i] = cellCenterHeight(terrain, cx, cz);
      sampledCenter[i] = sampleHeight(terrain, (cx + 0.5) * cs, (cz + 0.5) * cs);
      sampledEastMid[i] = sampleHeight(terrain, (cx + 1) * cs, (cz + 0.5) * cs);
      sampledSouthMid[i] = sampleHeight(terrain, (cx + 0.5) * cs, (cz + 1) * cs);
      grade[i] = cellGrade(terrain, cx, cz);
      cover[i] = COVER_LEVELS.indexOf(layer.cover);
      directionalCover[i] = layer.directionalCover ? 1 : 0;
      flammable[i] = layer.flammable ? 1 : 0;
      sightHeight[i] = layer.sight.heightM;
      sightDensity[i] = layer.sight.densityPerM;
      for (const profile of MOVEMENT_PROFILES) {
        const metersPerAp = layer.metersPerAp[profile];
        const tooSteep = (grade[i] as number) > rules.movement.maxWalkableGrade[profile];
        const cost = metersPerAp > 0 && !tooSteep ? 1 / metersPerAp : IMPASSABLE;
        apPerMeter[profile][i] = cost;
        if (cost < minApPerMeter[profile]) minApPerMeter[profile] = cost;
      }
    }
  }

  return {
    terrain,
    width: terrain.width,
    depth: terrain.depth,
    cellSize: terrain.cellSize,
    uphillPenaltyPerGrade: rules.movement.uphillPenaltyPerGrade,
    orthogonalLengthM: Math.hypot(cs, 0),
    diagonalLengthM: Math.hypot(cs, cs),
    centerHeight,
    sampledCenter,
    sampledEastMid,
    sampledSouthMid,
    sampledCorner,
    apPerMeter,
    minApPerMeter,
    cover,
    directionalCover,
    flammable,
    sightHeight,
    sightDensity,
  };
}

export function coverLevelAt(nav: NavGrid, index: number): CoverLevel {
  return COVER_LEVELS[nav.cover[index] as number] as CoverLevel;
}

export function isPassable(nav: NavGrid, profile: MovementProfile, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= nav.width || cz >= nav.depth) return false;
  return (nav.apPerMeter[profile][cz * nav.width + cx] as number) < IMPASSABLE;
}

/**
 * Canonical AP cost of walking a straight segment. Each crossed cell contributes
 * length × AP/m × (1 + uphill penalty × positive grade over that piece).
 * Returns IMPASSABLE if the segment enters a blocked cell or squeezes diagonally between
 * two blocked cells. `blocked` adds dynamic obstacles (e.g. enemy-occupied cells).
 */
export function segmentCost(
  nav: NavGrid,
  profile: MovementProfile,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  blocked?: (index: number) => boolean,
): number {
  const costs = nav.apPerMeter[profile];
  const lengthM = Math.hypot(bx - ax, bz - az);
  if (lengthM === 0) return 0;
  const terrain = nav.terrain;
  const isBlocked = (cx: number, cz: number): boolean => {
    if (cx < 0 || cz < 0 || cx >= nav.width || cz >= nav.depth) return true;
    const i = cz * nav.width + cx;
    return (costs[i] as number) === IMPASSABLE || (blocked?.(i) ?? false);
  };
  let total = 0;
  const ok = traverseSegment(
    nav,
    ax,
    az,
    bx,
    bz,
    (cx, cz, t0, t1) => {
      if (isBlocked(cx, cz)) return false;
      const pieceM = (t1 - t0) * lengthM;
      const h0 = sampleHeight(terrain, ax + (bx - ax) * t0, az + (bz - az) * t0);
      const h1 = sampleHeight(terrain, ax + (bx - ax) * t1, az + (bz - az) * t1);
      const uphillGrade = h1 > h0 ? (h1 - h0) / pieceM : 0;
      total += pieceM * (costs[cz * nav.width + cx] as number) * (1 + nav.uphillPenaltyPerGrade * uphillGrade);
      return true;
    },
    (sax, saz, sbx, sbz) => !(isBlocked(sax, saz) || isBlocked(sbx, sbz)),
  );
  return ok ? total : IMPASSABLE;
}
