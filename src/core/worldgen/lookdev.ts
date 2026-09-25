/**
 * Look-dev scene (brief §13): a 128 × 128 m slice of landscape holding every visual ingredient —
 * forest edge, wheat field, two houses, a path, a stretch of river, a wall segment with a tower
 * and four characters (two per side). Fully deterministic from its seed.
 */
import { clamp, smoothstep } from '../math/scalar.ts';
import type { Vec2 } from '../math/vec2.ts';
import { createSimplex, fbm, warpedFbm, type FbmOptions } from '../noise/noise.ts';
import { Rng, type Seed } from '../rng.ts';
import { TerrainLayer } from '../rules/types.ts';
import { cellCenterHeight, createTerrainData, sampleHeight } from '../terrain-data/terrain-data.ts';
import { catmullRom, orientedRect, pointInPolygon, projectOnPolyline } from './geometry.ts';
import { poissonScatter } from './scatter.ts';
import { carveChannel, fillHeights, flattenPolygon, paintAlongPolyline, paintCells, paintDisc, paintPolygon, smoothAlong, STRUCTURAL_LAYERS } from './stamps.ts';
import type { FieldPatch, HedgeLine, HouseSite, TowerSite, TreeInstance, TreeSpecies, WallRun, WorldLayout } from './types.ts';

export const LOOKDEV_SIZE_M = 128;
const CURVE_SAMPLES = 10;

const RELIEF: FbmOptions = { octaves: 4, lacunarity: 2, gain: 0.5, frequency: 1 / 70 };
const FOREST_MASK: FbmOptions = { octaves: 3, lacunarity: 2, gain: 0.5, frequency: 1 / 38 };

const RIVER = { widthM: 9, levelM: 0.2, bedM: -1.5, bankM: 4, control: [{ x: -8, z: 66 }, { x: 16, z: 84 }, { x: 30, z: 104 }, { x: 36, z: 136 }] };
const PATH = { widthM: 2.6, control: [{ x: 74, z: 134 }, { x: 66, z: 108 }, { x: 70, z: 84 }, { x: 84, z: 62 }, { x: 96, z: 44 }] };
const WALL = { heightM: 8.5, thicknessM: 2.4, points: [{ x: 76, z: 20 }, { x: 102, z: 27 }, { x: 128, z: 44 }] };
const TOWER = { center: { x: 102, z: 27 }, radiusM: 3.6, heightM: 13 };
const BUTTE = { rise: 6.5, from: 0.5, to: 0.95 };
const FIELD_POLY: Vec2[] = [
  { x: 82, z: 74 },
  { x: 116, z: 70 },
  { x: 122, z: 98 },
  { x: 88, z: 104 },
];
const HOUSES: readonly Omit<HouseSite, 'baseHeightM'>[] = [
  { id: 'house-a', center: { x: 52, z: 70 }, rotationTurns: 0.03, widthM: 6, depthM: 4, floors: 1, roof: 'thatch', seed: 11 },
  { id: 'house-b', center: { x: 50, z: 91 }, rotationTurns: -0.06, widthM: 4, depthM: 6, floors: 2, roof: 'tile', seed: 23 },
];

function reliefHeight(noise: (x: number, z: number) => number, x: number, z: number): number {
  const base = 1.1 + fbm(noise, x, z, RELIEF) * 1.4;
  // Butte of the castle rising towards the north-east corner (high x, low z).
  const t = clamp((x / LOOKDEV_SIZE_M + (LOOKDEV_SIZE_M - z) / LOOKDEV_SIZE_M) / 2, 0, 1);
  return base + BUTTE.rise * smoothstep(BUTTE.from, BUTTE.to, t);
}

function speciesFor(rng: Rng, core: number): TreeSpecies {
  if (core > 0.75) return rng.weighted([{ weight: 5, v: 'beech' }, { weight: 3, v: 'oak' }, { weight: 2, v: 'pine' }] as const).v;
  return rng.weighted([{ weight: 5, v: 'oak' }, { weight: 3, v: 'birch' }, { weight: 1, v: 'beech' }] as const).v;
}

export function generateLookdev(seed: Seed = 'lookdev'): WorldLayout {
  const root = Rng.create(seed);
  const t = createTerrainData(LOOKDEV_SIZE_M, LOOKDEV_SIZE_M);
  const relief = createSimplex(root.fork('relief'));
  const forestNoise = createSimplex(root.fork('forest'));

  const river = catmullRom(RIVER.control, CURVE_SAMPLES);
  const path = catmullRom(PATH.control, CURVE_SAMPLES);

  // --- Relief -----------------------------------------------------------------------------
  fillHeights(t, (x, z) => reliefHeight(relief, x, z));
  carveChannel(t, river, RIVER.widthM / 2, RIVER.bankM, RIVER.bedM);
  smoothAlong(t, path, 4, 0.8);

  const houseSites: HouseSite[] = HOUSES.map((h) => {
    const footprint = orientedRect(h.center, h.widthM + 2, h.depthM + 2, h.rotationTurns);
    const baseHeightM = sampleHeight(t, h.center.x, h.center.z);
    flattenPolygon(t, footprint, baseHeightM, 3);
    return { ...h, baseHeightM };
  });

  const wallBase = Math.min(...WALL.points.map((p) => sampleHeight(t, Math.min(p.x, LOOKDEV_SIZE_M), p.z)));
  for (let i = 0; i < WALL.points.length - 1; i++) {
    const a = WALL.points[i] as Vec2;
    const b = WALL.points[i + 1] as Vec2;
    const corridor = [a, b];
    // Level a berm under the wall so it sits on the ground, not on stilts.
    carveChannel(t, corridor, WALL.thicknessM, 3, wallBase);
  }

  // --- Layers --------------------------------------------------------------------------------
  const forestMask = (p: Vec2): number => {
    const regional = 1 - smoothstep(26, 52, p.x + 0.35 * (p.z - 40));
    const northWest = 1 - smoothstep(40, 72, p.z);
    const n = warpedFbm(forestNoise, p.x, p.z, 12, FOREST_MASK) * 0.5 + 0.5;
    return clamp(regional * northWest * 1.35 + (n - 0.5) * 0.7, 0, 1);
  };
  paintCells(t, TerrainLayer.Forest, (c) => forestMask(c) > 0.5);
  paintPolygon(t, FIELD_POLY, TerrainLayer.Field);
  paintAlongPolyline(t, river, RIVER.widthM / 2 + 1.6, TerrainLayer.Mud);
  paintAlongPolyline(t, river, RIVER.widthM / 2, TerrainLayer.River);
  paintAlongPolyline(t, path, PATH.widthM / 2, TerrainLayer.Road);

  const hedge: HedgeLine = { id: 'hedge-field', kind: 'hedge', points: [{ x: 80, z: 105 }, { x: 78, z: 90 }, { x: 81, z: 75 }] };
  paintAlongPolyline(t, hedge.points, 0.7, TerrainLayer.Hedge, [TerrainLayer.Plain, TerrainLayer.Field]);

  for (const h of houseSites) paintPolygon(t, orientedRect(h.center, h.widthM, h.depthM, h.rotationTurns), TerrainLayer.Building);
  const wall: WallRun = { id: 'wall', points: WALL.points, heightM: WALL.heightM, thicknessM: WALL.thicknessM, baseHeightM: wallBase };
  paintAlongPolyline(t, WALL.points, WALL.thicknessM / 2, TerrainLayer.Wall);
  const tower: TowerSite = { id: 'tower', center: TOWER.center, radiusM: TOWER.radiusM, heightM: TOWER.heightM, baseHeightM: wallBase };
  paintDisc(t, TOWER.center, TOWER.radiusM, TerrainLayer.Wall);

  // --- Vegetation ----------------------------------------------------------------------------
  const blocked = (p: Vec2): boolean => {
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    if (cx < 0 || cz < 0 || cx >= t.width || cz >= t.depth) return true;
    const layer = t.layers[cz * t.width + cx] as number;
    return (STRUCTURAL_LAYERS as readonly number[]).includes(layer) || layer === TerrainLayer.Road || layer === TerrainLayer.Field;
  };
  const vegRng = root.fork('vegetation');
  const bounds = { minX: 0, minZ: 0, maxX: LOOKDEV_SIZE_M, maxZ: LOOKDEV_SIZE_M };
  const trees: TreeInstance[] = [];
  const treeSpots = poissonScatter(vegRng.fork('trees'), bounds, 4.2, (p) => (blocked(p) ? 0 : smoothstep(0.35, 0.8, forestMask(p))));
  for (const p of treeSpots) {
    const core = forestMask(p);
    trees.push({ species: speciesFor(vegRng, core), position: p, scale: vegRng.float(0.8, 1.25) * (0.75 + 0.3 * core), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  // Understory: bushes and ferns concentrated along the forest edge and the river banks.
  const underSpots = poissonScatter(vegRng.fork('under'), bounds, 2.2, (p) => {
    if (blocked(p)) return 0;
    const m = forestMask(p);
    const edge = 1 - Math.abs(m - 0.5) * 2;
    const bank = 1 - smoothstep(RIVER.widthM / 2 + 1, RIVER.widthM / 2 + 7, projectOnPolyline(p, river).distance);
    return clamp(edge * 0.8 + bank * 0.6 + m * 0.25, 0, 0.9);
  });
  for (const p of underSpots) {
    trees.push({ species: vegRng.chance(0.55) ? 'bush' : 'fern', position: p, scale: vegRng.float(0.7, 1.3), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  // A few lone trees in the meadow near the houses break the edge and frame the view.
  for (const p of [{ x: 60, z: 58 }, { x: 40, z: 100 }, { x: 118, z: 112 }]) {
    trees.push({ species: 'oak', position: p, scale: vegRng.float(1.05, 1.3), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }

  const fields: FieldPatch[] = [{ id: 'field-wheat', crop: 'wheat', polygon: FIELD_POLY, furrowTurns: 0.02 }];

  return {
    name: 'lookdev',
    terrain: t,
    playable: { minX: 0, minZ: 0, maxX: LOOKDEV_SIZE_M, maxZ: LOOKDEV_SIZE_M },
    trees: trees.filter((tr) => !blocked(tr.position) && !pointInPolygon(tr.position, FIELD_POLY)),
    fields,
    houses: houseSites,
    water: [{ id: 'river', kind: 'river', centerline: river, widthM: RIVER.widthM, levelM: RIVER.levelM }],
    roads: [{ id: 'path', kind: 'path', centerline: path, widthM: PATH.widthM }],
    hedges: [hedge],
    walls: [wall],
    towers: [tower],
    units: [
      { id: 'att-1', faction: 'attacker', typeKey: 'knight', position: { x: 70.5, z: 66.5 }, facingTurns: 0.62 },
      { id: 'att-2', faction: 'attacker', typeKey: 'archer', position: { x: 66.5, z: 70.5 }, facingTurns: 0.6 },
      { id: 'def-1', faction: 'defender', typeKey: 'wallGuard', position: { x: 90.5, z: 44.5 }, facingTurns: 0.12 },
      { id: 'def-2', faction: 'defender', typeKey: 'crossbowman', position: { x: 96.5, z: 46.5 }, facingTurns: 0.1 },
    ],
    focus: { x: 74, z: 66 },
  };
}

/** Ground height at a unit marker (cell centre), for placing props and characters. */
export function groundAt(layout: WorldLayout, p: Vec2): number {
  return cellCenterHeight(layout.terrain, Math.floor(p.x), Math.floor(p.z));
}
