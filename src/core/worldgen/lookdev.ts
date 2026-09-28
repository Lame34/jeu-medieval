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
import { catmullRom, orientedRect, pointAlong, pointInPolygon, polylineLength, projectOnPolyline } from './geometry.ts';
import { poissonScatter } from './scatter.ts';
import { carveChannel, fillHeights, flattenPolygon, paintAlongPolyline, paintCells, paintDisc, paintPolygon, smoothAlong, STRUCTURAL_LAYERS } from './stamps.ts';
import type { FieldPatch, HedgeLine, HouseSite, TowerSite, TreeInstance, TreeSpecies, WallRun, WorldLayout } from './types.ts';

export const LOOKDEV_SIZE_M = 128;
const CURVE_SAMPLES = 10;

const RELIEF: FbmOptions = { octaves: 4, lacunarity: 2, gain: 0.5, frequency: 1 / 70 };
const FOREST_MASK: FbmOptions = { octaves: 3, lacunarity: 2, gain: 0.5, frequency: 1 / 38 };

/** The river runs well beyond the map so the decorative ring can carry it to the horizon. */
const RIVER = {
  widthM: 9,
  levelM: 0.2,
  bedM: -1.5,
  bankM: 4,
  control: [
    { x: -140, z: 20 },
    { x: -60, z: 44 },
    { x: -8, z: 66 },
    { x: 16, z: 84 },
    { x: 30, z: 104 },
    { x: 36, z: 136 },
    { x: 60, z: 220 },
    { x: 40, z: 320 },
  ],
};
const PATH = { widthM: 2.6, control: [{ x: 74, z: 134 }, { x: 66, z: 108 }, { x: 70, z: 84 }, { x: 84, z: 62 }, { x: 96, z: 44 }] };
const WALL = { heightM: 8.5, thicknessM: 2.4, points: [{ x: 76, z: 20 }, { x: 102, z: 27 }, { x: 128, z: 44 }] };
const TOWER = { center: { x: 102, z: 27 }, radiusM: 3.6, heightM: 13 };
// The butte levels off before the map corner (a rise up to the edge reads as a plinth).
const BUTTE = { rise: 6.5, from: 0.5, to: 0.8 };
const FIELD_POLY: Vec2[] = [
  { x: 82, z: 74 },
  { x: 97, z: 71.5 },
  { x: 116, z: 70 },
  { x: 119.5, z: 83 },
  { x: 122, z: 98 },
  { x: 104, z: 102.5 },
  { x: 88, z: 104 },
  { x: 84.5, z: 89 },
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

  const hedge: HedgeLine = { id: 'hedge-field', kind: 'hedge', points: [{ x: 86, z: 106 }, { x: 82.5, z: 89 }, { x: 80, z: 72.5 }] };
  const dryWall: HedgeLine = { id: 'wall-field', kind: 'dryStoneWall', points: [{ x: 89, z: 106 }, { x: 104, z: 104.6 }, { x: 123, z: 100 }] };
  paintAlongPolyline(t, hedge.points, 0.7, TerrainLayer.Hedge, [TerrainLayer.Plain, TerrainLayer.Field]);
  paintAlongPolyline(t, dryWall.points, 0.5, TerrainLayer.DryStoneWall, [TerrainLayer.Plain, TerrainLayer.Field]);

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
    // Wide size range (0.6–1.5): a wood of mixed ages, not a block of identical lollipops.
    trees.push({ species: speciesFor(vegRng, core), position: p, scale: vegRng.float(0.6, 1.5) * (0.8 + 0.25 * core), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  // Ecotone: young trees scattered in a band just outside the wood, softening the edge.
  const ecotone = poissonScatter(vegRng.fork('ecotone'), bounds, 6, (p) => {
    if (blocked(p)) return 0;
    const m = forestMask(p);
    return 0.55 * smoothstep(0.22, 0.32, m) * (1 - smoothstep(0.42, 0.5, m));
  });
  for (const p of ecotone) {
    trees.push({ species: vegRng.chance(0.5) ? 'birch' : 'oak', position: p, scale: vegRng.float(0.5, 0.8), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  // Hedgerow trees: one standard every ~18 m along the hedge.
  const hedgeLength = polylineLength(hedge.points);
  for (let s = 9; s < hedgeLength; s += 18) {
    trees.push({ species: 'oak', position: pointAlong(hedge.points, s), scale: vegRng.float(0.85, 1.1), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  // Understory and bushes: in clusters along edges — a band in front of the wood, the river
  // bank, the field border, the foot of the wall and of the hedge — sparse in the open meadow
  // and never on the verge of the path (review v13, #6).
  const clusterNoise = createSimplex(root.fork('bush-clusters'));
  const underSpots = poissonScatter(vegRng.fork('under'), bounds, 1.9, (p) => {
    if (blocked(p)) return 0;
    const m = forestMask(p);
    const edge = 1 - Math.abs(m - 0.5) * 2;
    const bank = 1 - smoothstep(RIVER.widthM / 2 + 1, RIVER.widthM / 2 + 7, projectOnPolyline(p, river).distance);
    const pathD = projectOnPolyline(p, path).distance;
    const clearOfPath = smoothstep(PATH.widthM / 2 + 3, PATH.widthM / 2 + 4, pathD);
    const fieldD = pointInPolygon(p, FIELD_POLY) ? 0 : projectOnPolyline(p, [...FIELD_POLY, FIELD_POLY[0] as Vec2]).distance;
    const fieldBorder = fieldD > 0 ? 1 - smoothstep(1.5, 4, fieldD) : 0;
    const wallFoot = 1 - smoothstep(2, 6, projectOnPolyline(p, WALL.points).distance);
    const hedgeFoot = 1 - smoothstep(1, 4, projectOnPolyline(p, hedge.points).distance);
    // Band in front of the wood (forest mask just below its edge), not the edge line itself.
    const woodFront = smoothstep(0.18, 0.3, m) * (1 - smoothstep(0.45, 0.55, m));
    const zone = Math.max(woodFront, edge * 0.5, bank * 0.6, fieldBorder * 0.45, wallFoot * 0.35, hedgeFoot * 0.9, 0.015);
    const cluster = smoothstep(0.1, 0.35, fbm(clusterNoise, p.x, p.z, { octaves: 2, lacunarity: 2, gain: 0.5, frequency: 1 / 9 }));
    return clamp((zone * cluster + m * 0.25) * clearOfPath, 0, 0.9);
  });
  for (const p of underSpots) {
    // Ferns only in the shade of the wood; bushes along edges and banks.
    const fern = forestMask(p) > 0.45 && vegRng.chance(0.6);
    trees.push({ species: fern ? 'fern' : 'bush', position: p, scale: vegRng.float(0.6, 1.7), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  // A few lone trees in the meadow near the houses break the edge and frame the view.
  for (const p of [{ x: 60, z: 58 }, { x: 40, z: 100 }, { x: 118, z: 112 }]) {
    trees.push({ species: 'oak', position: p, scale: vegRng.float(1.05, 1.3), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }

  const fields: FieldPatch[] = [{ id: 'field-wheat', crop: 'wheat', polygon: FIELD_POLY, furrowTurns: 0.02 }];
  // Wall-walk spot of the guard: on the centreline, a step inside (the merlons face -z).
  const walkA = WALL.points[0] as Vec2;
  const walkB = WALL.points[1] as Vec2;
  const wallWalk = { x: walkA.x + (walkB.x - walkA.x) * 0.55, z: walkA.z + (walkB.z - walkA.z) * 0.55 + 0.4 };

  return {
    name: 'lookdev',
    terrain: t,
    playable: { minX: 0, minZ: 0, maxX: LOOKDEV_SIZE_M, maxZ: LOOKDEV_SIZE_M },
    trees: trees.filter((tr) => !blocked(tr.position) && !pointInPolygon(tr.position, FIELD_POLY)),
    fields,
    houses: houseSites,
    water: [{ id: 'river', kind: 'river', centerline: river, widthM: RIVER.widthM, levelM: RIVER.levelM }],
    roads: [{ id: 'path', kind: 'path', centerline: path, widthM: PATH.widthM }],
    hedges: [hedge, dryWall],
    walls: [wall],
    towers: [tower],
    gates: [],
    keeps: [],
    bridges: [],
    units: [
      // A skirmish in the close-up (one unit of each side), an archer behind, and a guard on
      // the wall-walk who gives the wall its scale.
      { id: 'att-1', faction: 'attacker', typeKey: 'knight', position: { x: 70.5, z: 66.5 }, facingTurns: 0.387 },
      { id: 'att-2', faction: 'attacker', typeKey: 'archer', position: { x: 63.5, z: 73.5 }, facingTurns: 0.1 },
      { id: 'def-1', faction: 'defender', typeKey: 'wallGuard', position: wallWalk, facingTurns: 0.5, elevationM: wallBase + WALL.heightM },
      { id: 'def-2', faction: 'defender', typeKey: 'crossbowman', position: { x: 73.5, z: 63 }, facingTurns: 0.887 },
    ],
    focus: { x: 74, z: 66 },
  };
}

/** Ground height at a unit marker (cell centre), for placing props and characters. */
export function groundAt(layout: WorldLayout, p: Vec2): number {
  return cellCenterHeight(layout.terrain, Math.floor(p.x), Math.floor(p.z));
}
