/**
 * Procedural battle map (brief §9.12): 512 × 512 m (500 m playable) generated from a seed —
 * relief with the castle butte, a meandering river with a ford and a bridge, roads routed over
 * the relief, a castle hugging the butte (towers, gatehouse, keep, moat), a village strung along
 * the main road, farms, Voronoi field parcels with hedges, forests covering ~30 % of the map.
 */
import { clamp, smoothstep } from '../math/scalar.ts';
import type { Vec2 } from '../math/vec2.ts';
import { createSimplex, fbm, ridged, warpedFbm, type FbmOptions } from '../noise/noise.ts';
import { Rng, type Seed } from '../rng.ts';
import { TerrainLayer } from '../rules/types.ts';
import { cellCenterHeight, cellGrade, createTerrainData, sampleHeight } from '../terrain-data/terrain-data.ts';
import { planCastle, turnsFacing, type CastlePlan } from './castle.ts';
import { stampCastleDecks } from './decks.ts';
import { buildParcels } from './fields.ts';
import { catmullRom, orientedRect, pointAlong, pointInPolygon, polylineLength, projectOnPolyline, subPolyline } from './geometry.ts';
import { CellMask } from './raster.ts';
import { crossingCells, findCrossingEndM, gateAxes, GATEHOUSE, liftTipM, passageCells } from './gatehouse.ts';
import { routeRoad } from './roads.ts';
import { poissonScatter } from './scatter.ts';
import {
  blendHeights,
  boundsOf,
  carveChannel,
  rampAlong,
  fillHeights,
  flattenPolygon,
  paintAlongPolyline,
  paintCells,
  paintPolygon,
  smoothAlong,
} from './stamps.ts';
import type { BridgeSite, FieldPatch, HedgeLine, HouseSite, RoadLine, TreeInstance, TreeSpecies, UnitMarker, WaterBody, WorldLayout } from './types.ts';

export const BATTLE_MAP_CELLS = 512;
export const PLAYABLE_MARGIN_M = 6;
const MAP_M = BATTLE_MAP_CELLS;

const RELIEF: FbmOptions = { octaves: 5, lacunarity: 2, gain: 0.5, frequency: 1 / 260 };
const RIDGES: FbmOptions = { octaves: 4, lacunarity: 2.1, gain: 0.5, frequency: 1 / 420 };
const FOREST: FbmOptions = { octaves: 4, lacunarity: 2, gain: 0.5, frequency: 1 / 110 };
const MEANDER: FbmOptions = { octaves: 2, lacunarity: 2, gain: 0.5, frequency: 1 / 300 };

const TERRAIN = { base: 4, reliefAmp: 8, ridgeAmp: 5 };
const BUTTE = { height: 15, topMargin: 12, slopeWidth: 70 };
const RIVER = { widthM: 12, levelM: 1, bedBelowM: 1.8, bankM: 5, valleyHalfM: 70, valleyAboveM: 1.4, fordFraction: 0.3, bridgeFraction: 0.62, fordLengthM: 14, fordBedBelowM: 0.35 };
const ROAD = { mainHalfM: 2.6, sideHalfM: 2.0, stepM: 4, slopePenalty: 40, riverClearM: 3, crossingRadiusM: 10, smoothRadiusM: 6 };
/** The castle ramp (J4): grade cap (engines climb 0.3), length bounds, road margin and shoulders. */
const RAMP = { grade: 0.2, minLengthM: 40, maxLengthM: 240, searchStepM: 2, marginM: 1.5, shoulderM: 7 };
const BRIDGE = { widthM: 5.5, landingM: 5, deckAboveWaterM: 1.8 };
const VILLAGE = { spanM: 95, minHouses: 8, maxHouses: 15, offsetM: 12, spacingM: 12, marginM: 2 };
const FARMS = { count: 3, fieldRingM: 70 };
const FIELDS = { spacingM: 30, cellRadiusM: 24, insetM: 1.6, minAreaM2: 220 };
const FOREST_TARGET = 0.3;
const CASTLE_CLEAR_M = 45;
const DEPLOY = { depthM: 60 };
const MOAT_BED_BELOW_M = 1.6;
/** Houses are not built across more than this height difference (diagonal of the plot). */
const MAX_HOUSE_SLOPE_DROP_M = 2.2;
const TREES = { minDistM: 4.6, underDistM: 2.4, hedgeTreeEveryM: 11 };
/** Castle garrison (J4): on the wall-walk (spread along the curtain), and in the courtyard. */
const GARRISON = { wall: ['crossbowman', 'wallGuard', 'crossbowman', 'wallGuard'], courtyard: ['officer', 'militia'], searchCells: 3 } as const;
/** J3 village outpost: defenders placed on open ground on a circle around the village centre. */
const OUTPOST = { types: ['militia', 'crossbowman', 'militia', 'sallyKnight'], radiusM: 13, angleOffset: 0.4, searchCells: 12, maxGrade: 0.6 } as const;
/**
 * J4 siege park: the engines, assembled overnight, wait on the approach road this far from the
 * gate (beyond the reach of the tower archers, the walls within catapult range), side by side.
 */
const SIEGE_PARK = { types: ['ram', 'catapult'], distanceM: 62, spacingM: 7, maxGrade: 0.28 } as const;
/** The gate-tower archer who works the drawbridge winch (J4): killing them drops the bridge. */
const WINCH_OPERATOR_ID = 'def-tower-0';
const OPEN_LAYERS = [TerrainLayer.Plain, TerrainLayer.Road, TerrainLayer.Field] as const;

export interface BattleMapParams {
  readonly seed: Seed;
  /** 1–4: campaign castle index (size, towers, garrison). */
  readonly castleIndex: 1 | 2 | 3 | 4;
}

export interface GeneratedMap {
  readonly layout: WorldLayout;
  readonly castle: CastlePlan;
  readonly forestCoverage: number;
}

type HouseDraft = Omit<HouseSite, 'baseHeightM'>;

const HOUSE_SIZES: readonly (readonly [number, number])[] = [
  [4, 4],
  [6, 4],
  [4, 6],
  [6, 6],
  [4, 8],
];

function speciesFor(rng: Rng, core: number): TreeSpecies {
  if (core > 0.8) return rng.weighted([{ weight: 4, v: 'beech' }, { weight: 3, v: 'oak' }, { weight: 3, v: 'pine' }] as const).v;
  return rng.weighted([{ weight: 5, v: 'oak' }, { weight: 3, v: 'birch' }, { weight: 2, v: 'beech' }] as const).v;
}

export function generateBattleMap(params: BattleMapParams): GeneratedMap {
  const root = Rng.create(params.seed);
  const t = createTerrainData(BATTLE_MAP_CELLS, BATTLE_MAP_CELLS);
  const relief = createSimplex(root.fork('relief'));
  const ridgeNoise = createSimplex(root.fork('ridges'));
  const meander = createSimplex(root.fork('meander'));
  const forestNoise = createSimplex(root.fork('forest'));
  const layoutRng = root.fork('layout');
  const lo = PLAYABLE_MARGIN_M;
  const hi = MAP_M - PLAYABLE_MARGIN_M;

  // --- Castle site and relief ---------------------------------------------------------------
  const castleRadius = 34 + 4 * params.castleIndex;
  const towerCount = clamp(3 + params.castleIndex + layoutRng.int(0, 1), 3, 8);
  const moatOffset = 11;
  const moatWidth = 9;
  const castleCenter = { x: MAP_M / 2 + layoutRng.float(-70, 70), z: 150 + layoutRng.float(-20, 25) };
  const plateauR = castleRadius * (1 + 0.14) + moatOffset + moatWidth / 2 + BUTTE.topMargin;
  fillHeights(t, (x, z) => {
    const base = TERRAIN.base + fbm(relief, x, z, RELIEF) * TERRAIN.reliefAmp + ridged(ridgeNoise, x, z, RIDGES) * TERRAIN.ridgeAmp;
    const d = Math.hypot(x - castleCenter.x, z - castleCenter.z);
    return base + BUTTE.height * (1 - smoothstep(plateauR, plateauR + BUTTE.slopeWidth, d));
  });
  const plateauH = sampleHeight(t, castleCenter.x, castleCenter.z) + 1;

  // --- River: west → east, south of the castle, meandering ----------------------------------
  const riverZ = castleCenter.z + 180 + layoutRng.float(-15, 35);
  const riverControl: Vec2[] = [];
  for (let x = -180; x <= MAP_M + 180; x += 90) {
    riverControl.push({ x, z: riverZ + fbm(meander, x, riverZ, MEANDER) * 60 });
  }
  const river = catmullRom(riverControl, 10);
  blendHeights(
    t,
    (x, z) => 1 - smoothstep(RIVER.widthM, RIVER.valleyHalfM, projectOnPolyline({ x, z }, river).distance),
    () => RIVER.levelM + RIVER.valleyAboveM,
    boundsOf(river, RIVER.valleyHalfM),
  );
  carveChannel(t, river, RIVER.widthM / 2, RIVER.bankM, RIVER.levelM - RIVER.bedBelowM);
  // Crossings measured along the in-map part of the river.
  const inMapStart = projectOnPolyline({ x: lo, z: riverZ }, river).along;
  const inMapEnd = projectOnPolyline({ x: hi, z: riverZ }, river).along;
  const ford = pointAlong(river, inMapStart + (inMapEnd - inMapStart) * RIVER.fordFraction);
  const bridgePoint = pointAlong(river, inMapStart + (inMapEnd - inMapStart) * RIVER.bridgeFraction);
  const fordLine = [pointAlong(river, projectOnPolyline(ford, river).along - RIVER.fordLengthM / 2), pointAlong(river, projectOnPolyline(ford, river).along + RIVER.fordLengthM / 2)];
  carveChannel(t, fordLine, RIVER.widthM / 2 + 1, 3, RIVER.levelM - RIVER.fordBedBelowM);

  const riverNormalAt = (p: Vec2): Vec2 => {
    const s = projectOnPolyline(p, river).along;
    const a = pointAlong(river, s - 3);
    const b = pointAlong(river, s + 3);
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
  };
  const bn = riverNormalAt(bridgePoint);
  const span = RIVER.widthM / 2 + BRIDGE.landingM;
  // Orient so `bridgeNorth` is on the castle side (smaller z).
  const sideSign = bn.z < 0 ? 1 : -1;
  const bridgeNorth = { x: bridgePoint.x + bn.x * span * sideSign, z: bridgePoint.z + bn.z * span * sideSign };
  const bridgeSouth = { x: bridgePoint.x - bn.x * span * sideSign, z: bridgePoint.z - bn.z * span * sideSign };
  const fn = riverNormalAt(ford);
  const fordNorth = { x: ford.x + fn.x * span * (fn.z < 0 ? 1 : -1), z: ford.z + fn.z * span * (fn.z < 0 ? 1 : -1) };
  const fordSouth = { x: ford.x - fn.x * span * (fn.z < 0 ? 1 : -1), z: ford.z - fn.z * span * (fn.z < 0 ? 1 : -1) };

  // --- Castle plan (gate faces the village road) --------------------------------------------
  const villageCenterGuess = { x: (bridgeNorth.x + castleCenter.x) / 2, z: (bridgeNorth.z + castleCenter.z) / 2 + 10 };
  const approachLen = Math.hypot(villageCenterGuess.x - castleCenter.x, villageCenterGuess.z - castleCenter.z) || 1;
  const castle = planCastle(root.fork('castle'), {
    center: castleCenter,
    radiusM: castleRadius,
    towerCount,
    approach: { x: (villageCenterGuess.x - castleCenter.x) / approachLen, z: (villageCenterGuess.z - castleCenter.z) / approachLen },
    baseHeightM: plateauH,
    wallHeightM: 9 + params.castleIndex,
    wallThicknessM: 2.6,
    towerRadiusM: 4.2,
    towerHeightM: 14 + params.castleIndex,
    gateOpeningM: 4.5,
    moatOffsetM: moatOffset,
    moatWidthM: moatWidth,
    moatDepthM: 2.2,
    idPrefix: 'castle-',
  });
  const plateau: Vec2[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * 2 * Math.PI;
    plateau.push({ x: castleCenter.x + Math.cos(a) * plateauR, z: castleCenter.z + Math.sin(a) * plateauR });
  }
  flattenPolygon(t, plateau, plateauH, 18);
  carveChannel(t, castle.moat.centerline, moatWidth / 2, 2, castle.moat.levelM - MOAT_BED_BELOW_M);

  // --- Roads ----------------------------------------------------------------------------------
  const nearRiver = (x: number, z: number) => projectOnPolyline({ x, z }, river).distance < RIVER.widthM / 2 + ROAD.riverClearM;
  const nearCrossing = (x: number, z: number) =>
    Math.hypot(x - bridgePoint.x, z - bridgePoint.z) < ROAD.crossingRadiusM || Math.hypot(x - ford.x, z - ford.z) < ROAD.crossingRadiusM;
  const castleBlock = (x: number, z: number) => Math.hypot(x - castleCenter.x, z - castleCenter.z) < plateauR - 4;
  const roadCost = {
    stepM: ROAD.stepM,
    slopePenalty: ROAD.slopePenalty,
    extraCost: (x: number, z: number) => (castleBlock(x, z) || (nearRiver(x, z) && !nearCrossing(x, z)) ? Number.POSITIVE_INFINITY : 0),
  };
  const route = (a: Vec2, b: Vec2): Vec2[] => routeRoad(t, a, b, roadCost) ?? [a, b];
  const southEntry = { x: clamp(bridgeSouth.x + layoutRng.float(-60, 60), 60, MAP_M - 60), z: MAP_M };
  const approachRoad = route(bridgeNorth, castle.gateApproach);
  const villageCenter = pointAlong(approachRoad, 0.45 * polylineLength(approachRoad));
  const mainRoad = [...route(southEntry, bridgeSouth), ...route(bridgeNorth, villageCenter), ...route(villageCenter, castle.gateApproach).slice(1)];
  const westEntry = { x: 0, z: clamp(fordSouth.z + layoutRng.float(20, 80), 40, MAP_M - 40) };
  const westRoad = [...route(westEntry, fordSouth), ...route(fordNorth, villageCenter)];
  const eastEntry = { x: MAP_M, z: clamp(villageCenter.z + layoutRng.float(-60, 40), 40, riverZ - 40) };
  const eastRoad = route(eastEntry, villageCenter);
  const roads: RoadLine[] = [
    { id: 'road-main', kind: 'road', centerline: mainRoad, widthM: ROAD.mainHalfM * 2 },
    { id: 'road-west', kind: 'path', centerline: westRoad, widthM: ROAD.sideHalfM * 2 },
    { id: 'road-east', kind: 'path', centerline: eastRoad, widthM: ROAD.sideHalfM * 2 },
  ];
  // The climb to the castle is regraded into an even ramp the siege engines can take (J4): it
  // starts far enough down the main road to stay under the ramp grade.
  const mainLength = polylineLength(mainRoad);
  const rampTop = sampleHeight(t, castle.gateApproach.x, castle.gateApproach.z);
  let rampLength = RAMP.minLengthM;
  for (let len = RAMP.minLengthM; len <= Math.min(RAMP.maxLengthM, mainLength); len += RAMP.searchStepM) {
    const foot = pointAlong(mainRoad, mainLength - len);
    rampLength = len;
    if ((rampTop - sampleHeight(t, foot.x, foot.z)) / len <= RAMP.grade) break;
  }
  rampAlong(t, subPolyline(mainRoad, mainLength - rampLength, mainLength), ROAD.mainHalfM + RAMP.marginM, RAMP.shoulderM);
  for (const r of roads) smoothAlong(t, r.centerline, ROAD.smoothRadiusM, 0.7);

  // --- Village and farms -----------------------------------------------------------------------
  const exclusion = new CellMask(t.width, t.depth);
  for (const r of roads) exclusion.markPolyline(r.centerline, r.widthM / 2 + 3);
  exclusion.markPolyline(river, RIVER.widthM / 2 + 6);
  exclusion.markDisc(castleCenter, plateauR + 6);
  /** Roads, river and castle only: where nothing may grow, whatever else is around. */
  const hardBlock = new CellMask(t.width, t.depth);
  hardBlock.data.set(exclusion.data);

  const houses: HouseDraft[] = [];
  const houseRng = root.fork('houses');
  const target = houseRng.int(VILLAGE.minHouses, VILLAGE.maxHouses);
  const mainAlongV = projectOnPolyline(villageCenter, mainRoad).along;
  const placeHouse = (center: Vec2, facing: Vec2, prefix: string): boolean => {
    const [w, d] = houseRng.pick(HOUSE_SIZES);
    const rot = turnsFacing(facing);
    const rect = orientedRect(center, w + VILLAGE.marginM, d + VILLAGE.marginM, rot);
    if (rect.some((p) => exclusion.at(p)) || exclusion.at(center)) return false;
    const c0 = rect[0] as Vec2;
    const c2 = rect[2] as Vec2;
    if (Math.abs(sampleHeight(t, c0.x, c0.z) - sampleHeight(t, c2.x, c2.z)) > MAX_HOUSE_SLOPE_DROP_M) return false;
    houses.push({ id: `${prefix}-${houses.length}`, center, rotationTurns: rot, widthM: w, depthM: d, floors: houseRng.chance(0.4) ? 2 : 1, roof: houseRng.chance(0.55) ? 'thatch' : 'tile', seed: houseRng.int(1, 1e6) });
    exclusion.markPolygon(orientedRect(center, w + 6, d + 6, rot));
    return true;
  };
  for (let k = 0; houses.length < target && k < 40; k++) {
    const s = mainAlongV + (k % 2 === 0 ? 1 : -1) * Math.floor(k / 2) * VILLAGE.spacingM * 0.5;
    if (Math.abs(s - mainAlongV) > VILLAGE.spanM) continue;
    const p = pointAlong(mainRoad, s);
    const q = pointAlong(mainRoad, s + 2);
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const side = k % 4 < 2 ? 1 : -1;
    const normal = { x: (-(q.z - p.z) / len) * side, z: ((q.x - p.x) / len) * side };
    const center = { x: p.x + normal.x * (VILLAGE.offsetM + houseRng.float(0, 3)), z: p.z + normal.z * (VILLAGE.offsetM + houseRng.float(0, 3)) };
    placeHouse(center, { x: -normal.x, z: -normal.z }, 'village');
  }
  const farmCenters: Vec2[] = [];
  for (const [road, frac] of [
    [westRoad, 0.35],
    [eastRoad, 0.4],
    [mainRoad, 0.12],
  ] as const) {
    if (farmCenters.length >= FARMS.count) break;
    const p = pointAlong(road, polylineLength(road) * frac);
    const q = pointAlong(road, polylineLength(road) * frac + 2);
    const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const normal = { x: -(q.z - p.z) / len, z: (q.x - p.x) / len };
    const center = { x: p.x + normal.x * 16, z: p.z + normal.z * 16 };
    if (placeHouse(center, { x: -normal.x, z: -normal.z }, 'farm')) farmCenters.push(center);
  }
  const houseSites: HouseSite[] = houses.map((h) => {
    const baseHeightM = sampleHeight(t, h.center.x, h.center.z);
    flattenPolygon(t, orientedRect(h.center, h.widthM + 2, h.depthM + 2, h.rotationTurns), baseHeightM, 3);
    return { ...h, baseHeightM };
  });

  // --- Fields -----------------------------------------------------------------------------------
  const fieldRng = root.fork('fields');
  const fieldSeeds = poissonScatter(fieldRng.fork('seeds'), { minX: lo, minZ: lo, maxX: hi, maxZ: hi }, FIELDS.spacingM, (p) => {
    const dv = Math.hypot(p.x - villageCenter.x, p.z - villageCenter.z);
    const nearVillage = dv > 35 && dv < 150 ? 1 : 0;
    const nearFarm = farmCenters.some((f) => Math.hypot(p.x - f.x, p.z - f.z) < FARMS.fieldRingM) ? 1 : 0;
    return Math.max(nearVillage * 0.9, nearFarm);
  });
  const fieldBlock = new CellMask(t.width, t.depth);
  fieldBlock.data.set(exclusion.data);
  const parcels = buildParcels(
    fieldRng,
    fieldSeeds,
    { maxCellRadiusM: FIELDS.cellRadiusM, insetM: FIELDS.insetM, minAreaM2: FIELDS.minAreaM2 },
    (poly) => poly.every((p) => !fieldBlock.at(p) && p.x > lo && p.z > lo && p.x < hi && p.z < hi),
    'battle-',
  );
  const fields: FieldPatch[] = parcels.fields;
  const hedges: HedgeLine[] = parcels.hedges.filter((h) => h.points.every((p) => !exclusion.at(p)));
  for (const f of fields) exclusion.markPolygon(f.polygon, 1);

  // --- Layers -------------------------------------------------------------------------------------
  const deployment = { minX: 40, minZ: MAP_M - DEPLOY.depthM - lo, maxX: MAP_M - 40, maxZ: hi };
  const forestBlock = new CellMask(t.width, t.depth);
  forestBlock.data.set(exclusion.data);
  forestBlock.markDisc(castleCenter, plateauR + CASTLE_CLEAR_M);
  forestBlock.markRect({ minX: deployment.minX + 60, minZ: deployment.minZ + 10, maxX: deployment.maxX - 60, maxZ: deployment.maxZ });
  for (const h of hedges) forestBlock.markPolyline(h.points, 2);
  const forestValue = new Float32Array(t.width * t.depth);
  const candidates: number[] = [];
  for (let cz = 0; cz < t.depth; cz++) {
    for (let cx = 0; cx < t.width; cx++) {
      const i = cz * t.width + cx;
      if (forestBlock.data[i]) continue;
      const v = warpedFbm(forestNoise, cx + 0.5, cz + 0.5, 30, FOREST);
      forestValue[i] = v;
      candidates.push(v);
    }
  }
  candidates.sort((a, b) => b - a);
  const wanted = Math.floor(FOREST_TARGET * (hi - lo) * (hi - lo));
  const threshold = candidates[Math.min(candidates.length - 1, wanted)] ?? 1;
  let forestCells = 0;
  paintCells(t, TerrainLayer.Forest, (_c, cx, cz) => {
    const i = cz * t.width + cx;
    const ok = !forestBlock.data[i] && (forestValue[i] as number) >= threshold;
    if (ok) forestCells++;
    return ok;
  });
  for (const f of fields) paintPolygon(t, f.polygon, TerrainLayer.Field);
  for (const h of hedges) paintAlongPolyline(t, h.points, 0.7, h.kind === 'hedge' ? TerrainLayer.Hedge : TerrainLayer.DryStoneWall, [TerrainLayer.Plain, TerrainLayer.Field]);
  paintAlongPolyline(t, river, RIVER.widthM / 2 + 2, TerrainLayer.Mud);
  paintAlongPolyline(t, river, RIVER.widthM / 2, TerrainLayer.River);
  paintAlongPolyline(t, fordLine, RIVER.widthM / 2 + 1, TerrainLayer.Ford, [TerrainLayer.River, TerrainLayer.Mud]);
  for (const r of roads) paintAlongPolyline(t, r.centerline, r.widthM / 2, TerrainLayer.Road, [TerrainLayer.Plain, TerrainLayer.Forest, TerrainLayer.Field, TerrainLayer.Mud, TerrainLayer.Hedge, TerrainLayer.DryStoneWall]);
  const bridgeLine = [bridgeSouth, bridgeNorth];
  paintAlongPolyline(t, bridgeLine, BRIDGE.widthM / 2, TerrainLayer.Bridge, [TerrainLayer.River, TerrainLayer.Mud, TerrainLayer.Road]);
  for (const h of houseSites) paintPolygon(t, orientedRect(h.center, h.widthM, h.depthM, h.rotationTurns), TerrainLayer.Building);
  // Castle: moat, courtyard, walls, towers, keep; the gate stays closed (a wall) in J2.
  paintAlongPolyline(t, castle.moat.centerline, moatWidth / 2, TerrainLayer.Moat);
  paintPolygon(t, castle.ring, TerrainLayer.Plain);
  // Wall-walks and tower tops (walkable decks) and their stairs; the keep and the gate stay solid.
  const decks = stampCastleDecks(t, castle, castleCenter);
  if (castle.keep) paintPolygon(t, orientedRect(castle.keep.center, castle.keep.widthM, castle.keep.depthM, castle.keep.rotationTurns), TerrainLayer.Wall);
  const gateOut = gateAxes(castle.gate).out;
  // The passage (closed by the gate and the portcullis) and the gatehouse masonry on to both gate
  // towers: no gap beside the passage.
  for (const i of passageCells(t, castle.gate)) t.layers[i] = TerrainLayer.Wall;
  const gateTowers = castle.towers.filter((tw) => tw.id.includes('gate-tower')).map((tw) => tw.center);
  if (gateTowers.length === 2) paintAlongPolyline(t, gateTowers, GATEHOUSE.depthM / 2, TerrainLayer.Wall, [TerrainLayer.Plain]);
  // The moat crossing: the fixed timber bridge beyond the lifting span (a deck at sill height).
  const crossingEndM = findCrossingEndM(t, castle.gate);
  if (crossingEndM !== null) {
    for (const i of crossingCells(t, castle.gate, liftTipM(), crossingEndM)) {
      t.layers[i] = TerrainLayer.Bridge;
      decks.deck[i] = Math.max(0, castle.gate.baseHeightM - cellCenterHeight(t, i % t.width, Math.floor(i / t.width)));
    }
  }

  // --- Vegetation ---------------------------------------------------------------------------------
  const vegRng = root.fork('vegetation');
  const isForest = (p: Vec2) => {
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    return cx >= 0 && cz >= 0 && cx < t.width && cz < t.depth && t.layers[cz * t.width + cx] === TerrainLayer.Forest;
  };
  const coreOf = (p: Vec2) => clamp(((forestValue[Math.floor(p.z) * t.width + Math.floor(p.x)] ?? 0) - threshold) / 0.25, 0, 1);
  const trees: TreeInstance[] = [];
  const full = { minX: lo, minZ: lo, maxX: hi, maxZ: hi };
  for (const p of poissonScatter(vegRng.fork('trees'), full, TREES.minDistM, (q) => (isForest(q) ? 0.55 + 0.45 * coreOf(q) : 0))) {
    const core = coreOf(p);
    trees.push({ species: speciesFor(vegRng, core), position: p, scale: vegRng.float(0.85, 1.25) * (0.8 + 0.25 * core), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  for (const p of poissonScatter(vegRng.fork('under'), full, TREES.underDistM, (q) => (isForest(q) ? 0.35 * (1 - coreOf(q)) + 0.1 : 0))) {
    trees.push({ species: vegRng.chance(0.5) ? 'fern' : 'bush', position: p, scale: vegRng.float(0.7, 1.3), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
  }
  // Hedgerow trees and bushes along hedges; a few lone oaks in the open.
  for (const h of hedges) {
    if (h.kind !== 'hedge') continue;
    const len = polylineLength(h.points);
    for (let s = vegRng.float(0, TREES.hedgeTreeEveryM); s < len; s += TREES.hedgeTreeEveryM * vegRng.float(0.7, 1.5)) {
      const p = pointAlong(h.points, s);
      if (hardBlock.at(p)) continue;
      trees.push({ species: vegRng.chance(0.3) ? 'oak' : 'bush', position: p, scale: vegRng.float(0.8, 1.2), rotationTurns: vegRng.next(), tint: vegRng.float(-1, 1) });
    }
  }

  // --- Units (J2: markers for readability tests) ------------------------------------------------
  const units: UnitMarker[] = [];
  const attackTypes = ['knight', 'soldier', 'archer', 'archer', 'soldier', 'knight', 'sapper', 'archer'];
  attackTypes.forEach((typeKey, i) => {
    const x = MAP_M / 2 - 28 + (i % 4) * 14 + 0.5;
    const z = deployment.minZ + 18 + Math.floor(i / 4) * 10 + 0.5;
    units.push({ id: `att-${i}`, faction: 'attacker', typeKey, position: { x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5 }, facingTurns: 0.5 });
  });
  // Garrison: shooters and guards on the wall-walk, tower archers above the gate, an officer and
  // the militia in the courtyard.
  const mainWall = castle.walls[0];
  const walkTop = mainWall ? mainWall.baseHeightM + mainWall.heightM : plateauH;
  const onRampart = (p: Vec2): Vec2 | null => nearestLayerCell(t, p, TerrainLayer.Rampart, GARRISON.searchCells);
  if (mainWall) {
    const runLength = polylineLength(mainWall.points);
    GARRISON.wall.forEach((typeKey, i) => {
      const spot = onRampart(pointAlong(mainWall.points, ((i + 1) / (GARRISON.wall.length + 1)) * runLength));
      if (spot) units.push({ id: `def-wall-${i}`, faction: 'defender', typeKey, position: spot, facingTurns: turnsFacing({ x: spot.x - castleCenter.x, z: spot.z - castleCenter.z }), elevationM: walkTop });
    });
  }
  castle.towers.filter((tw) => tw.id.includes('gate-tower')).forEach((tower, i) => {
    const spot = onRampart(tower.center);
    if (spot) units.push({ id: `def-tower-${i}`, faction: 'defender', typeKey: 'towerArcher', position: spot, facingTurns: turnsFacing(gateOut), elevationM: walkTop });
  });
  GARRISON.courtyard.forEach((typeKey, i) => {
    const a = (i / GARRISON.courtyard.length) * 2 * Math.PI;
    const p = { x: castleCenter.x + Math.cos(a) * castleRadius * 0.3, z: castleCenter.z + Math.sin(a) * castleRadius * 0.3 };
    units.push({ id: `def-${i}`, faction: 'defender', typeKey, position: { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 }, facingTurns: turnsFacing(gateOut) });
  });
  // J4: the siege park, on the approach road short of the castle.
  const parkAlong = (() => {
    const total = polylineLength(mainRoad);
    for (let along = total; along > 0; along -= 1) {
      const q = pointAlong(mainRoad, along);
      if (Math.hypot(q.x - castle.gate.center.x, q.z - castle.gate.center.z) >= SIEGE_PARK.distanceM) return along;
    }
    return 0;
  })();
  const parkAt = pointAlong(mainRoad, parkAlong);
  const parkAhead = pointAlong(mainRoad, parkAlong + 2);
  const parkSide = (() => {
    const len = Math.hypot(parkAhead.x - parkAt.x, parkAhead.z - parkAt.z) || 1;
    return { x: -(parkAhead.z - parkAt.z) / len, z: (parkAhead.x - parkAt.x) / len };
  })();
  const parkTaken = new Set(units.map((u) => `${u.position.x},${u.position.z}`));
  SIEGE_PARK.types.forEach((typeKey, i) => {
    const offset = (i - (SIEGE_PARK.types.length - 1) / 2) * SIEGE_PARK.spacingM;
    const spot = nearestOpenCell(t, { x: parkAt.x + parkSide.x * offset, z: parkAt.z + parkSide.z * offset }, parkTaken, SIEGE_PARK.maxGrade);
    if (!spot) return;
    parkTaken.add(`${spot.x},${spot.z}`);
    units.push({ id: `att-siege-${i}`, faction: 'attacker', typeKey, position: spot, facingTurns: turnsFacing({ x: castle.gate.center.x - spot.x, z: castle.gate.center.z - spot.z }) });
  });
  // J3: a village outpost fights in the open (the castle garrison waits for the siege, J4).
  const deployCenter = { x: (deployment.minX + deployment.maxX) / 2, z: (deployment.minZ + deployment.maxZ) / 2 };
  const taken = new Set(units.map((u) => `${u.position.x},${u.position.z}`));
  OUTPOST.types.forEach((typeKey, i) => {
    const a = OUTPOST.angleOffset + (i / OUTPOST.types.length) * 2 * Math.PI;
    const spot = nearestOpenCell(t, { x: villageCenter.x + Math.cos(a) * OUTPOST.radiusM, z: villageCenter.z + Math.sin(a) * OUTPOST.radiusM }, taken);
    if (!spot) return;
    taken.add(`${spot.x},${spot.z}`);
    units.push({ id: `def-out-${i}`, faction: 'defender', typeKey, position: spot, facingTurns: turnsFacing({ x: deployCenter.x - spot.x, z: deployCenter.z - spot.z }) });
  });

  const bridges: BridgeSite[] = [{ id: 'bridge', from: bridgeSouth, to: bridgeNorth, widthM: BRIDGE.widthM, deckHeightM: RIVER.levelM + BRIDGE.deckAboveWaterM }];
  const water: WaterBody[] = [{ id: 'river', kind: 'river', centerline: river, widthM: RIVER.widthM, levelM: RIVER.levelM }, castle.moat];

  const layout: WorldLayout = {
    name: `battle-${String(params.seed)}`,
    terrain: t,
    playable: full,
    trees: trees.filter((tr) => {
      const cx = Math.floor(tr.position.x);
      const cz = Math.floor(tr.position.z);
      const layer = t.layers[cz * t.width + cx];
      return layer === TerrainLayer.Forest || layer === TerrainLayer.Plain || layer === TerrainLayer.Hedge;
    }),
    fields,
    houses: houseSites,
    water,
    roads,
    hedges,
    walls: castle.walls,
    towers: castle.towers,
    gates: [
      {
        ...castle.gate,
        ...(units.some((u) => u.id === WINCH_OPERATOR_ID) ? { winchOperatorId: WINCH_OPERATOR_ID } : {}),
        ...(crossingEndM !== null ? { crossingEndM } : {}),
      },
    ],
    keeps: castle.keep ? [castle.keep] : [],
    bridges,
    units,
    deployment,
    focus: { x: (villageCenter.x + castleCenter.x) / 2, z: (villageCenter.z + castleCenter.z) / 2 },
    deck: decks.deck,
    stairs: decks.stairs,
  };
  return { layout, castle, forestCoverage: forestCells / ((hi - lo) * (hi - lo)) };
}

/** Nearest cell centre of `layer` to `target`, within `searchCells`. */
function nearestLayerCell(t: ReturnType<typeof createTerrainData>, target: Vec2, layer: number, searchCells: number): Vec2 | null {
  const cx0 = Math.floor(target.x);
  const cz0 = Math.floor(target.z);
  for (let r = 0; r <= searchCells; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx >= 0 && cz >= 0 && cx < t.width && cz < t.depth && t.layers[cz * t.width + cx] === layer) return { x: cx + 0.5, z: cz + 0.5 };
      }
    }
  }
  return null;
}

/** Nearest cell centre to `target` on open ground (plain, road, field; slope up to `maxGrade`), not taken. */
function nearestOpenCell(t: ReturnType<typeof createTerrainData>, target: Vec2, taken: ReadonlySet<string>, maxGrade: number = OUTPOST.maxGrade): Vec2 | null {
  const cx0 = Math.floor(target.x);
  const cz0 = Math.floor(target.z);
  for (let r = 0; r <= OUTPOST.searchCells; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= t.width || cz >= t.depth) continue;
        const layer = t.layers[cz * t.width + cx] as number;
        if (!(OPEN_LAYERS as readonly number[]).includes(layer) || cellGrade(t, cx, cz) > maxGrade) continue;
        const spot = { x: cx + 0.5, z: cz + 0.5 };
        if (!taken.has(`${spot.x},${spot.z}`)) return spot;
      }
    }
  }
  return null;
}

/** True when a point lies inside a polygon list (helper for validation and tests). */
export function insideAny(p: Vec2, polygons: readonly (readonly Vec2[])[]): boolean {
  return polygons.some((poly) => pointInPolygon(p, poly));
}
