/**
 * GPU textures derived from TerrainData:
 *  - splat (RGBA8, 1 texel per cell): R road, G field soil, B mud/wet banks, A forest floor —
 *    box-blurred so the shader can break the transitions with noise (never linear, never cut);
 *  - heights (R16F, corners): read by the water shader for depth-based colour and foam.
 */
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, RGBAFormat, ClampToEdgeWrapping, UnsignedByteType } from 'three';
import { TerrainLayer, type TerrainLayerId } from '../../core/rules/types.ts';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { projectOnPolyline } from '../../core/worldgen/geometry.ts';
import type { HedgeLine, RoadLine, TreeInstance } from '../../core/worldgen/types.ts';

const CHANNELS = 4;
const BLUR_PASSES = 2;
const BYTE_MAX = 255;

type SplatChannel = 0 | 1 | 2 | 3;

const LAYER_CHANNEL: Partial<Record<TerrainLayerId, SplatChannel>> = {
  [TerrainLayer.Road]: 0,
  [TerrainLayer.Bridge]: 0,
  [TerrainLayer.Rubble]: 0,
  [TerrainLayer.Field]: 1,
  [TerrainLayer.Mud]: 2,
  [TerrainLayer.Ford]: 2,
  [TerrainLayer.River]: 2,
  [TerrainLayer.Moat]: 2,
  [TerrainLayer.Forest]: 3,
  [TerrainLayer.Building]: 0,
  [TerrainLayer.Wall]: 0,
};

function boxBlur(src: Float32Array, width: number, depth: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(src.length);
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < CHANNELS; c++) {
        let sum = 0;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= depth) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            sum += src[(zz * width + xx) * CHANNELS + c] as number;
            n++;
          }
        }
        out[(z * width + x) * CHANNELS + c] = sum / n;
      }
    }
  }
  return out;
}

/** Beaten-earth apron around houses (R) and mud/rubble strip at the foot of walls (B), in cells. */
const APRON_CELLS = 3;
const APRON_WEIGHT = 0.7;
const WALL_FOOT_CELLS = 2;
const WALL_FOOT_WEIGHT = 0.7;
/** Forest-floor patch under every crown (radius per unit of tree scale) and along hedges. */
const CANOPY_FLOOR_RADIUS_M = 2.6;
const CANOPY_FLOOR_WEIGHT = 0.75;
const HEDGE_FLOOR_M = 1.3;
const HEDGE_FLOOR_WEIGHT = 0.7;
const FOREST_CHANNEL = 3;
const CROWN_SPECIES = new Set(['oak', 'beech', 'birch', 'pine']);

/** Road edge ramp (m around the half-width): soft painted verges instead of 1 m steps. */
const ROAD_EDGE_INNER_M = 0.5;
const ROAD_EDGE_OUTER_M = 1.0;
const ROAD_CHANNEL = 0;

/**
 * Road weight from the exact distance to each centreline segment (the cell layer only says
 * "road or not", which blurs into a staircase at 1 texel per metre).
 */
/** Roads fade out over the last metres before the map edge: the ring cannot carry a 3 m track, so
 * it wears away into the grass instead of stopping on a straight line. */
const ROAD_BORDER_FADE_M = 14;

function stampRoads(t: TerrainData, weights: Float32Array, roads: readonly RoadLine[]): void {
  for (const road of roads) {
    const hw = road.widthM / 2;
    const reach = hw + ROAD_EDGE_OUTER_M + 1;
    for (let k = 0; k < road.centerline.length - 1; k++) {
      const a = road.centerline[k] as { x: number; z: number };
      const b = road.centerline[k + 1] as { x: number; z: number };
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      for (let cz = Math.floor(Math.min(a.z, b.z) - reach); cz <= Math.ceil(Math.max(a.z, b.z) + reach); cz++) {
        if (cz < 0 || cz >= t.depth) continue;
        for (let cx = Math.floor(Math.min(a.x, b.x) - reach); cx <= Math.ceil(Math.max(a.x, b.x) + reach); cx++) {
          if (cx < 0 || cx >= t.width) continue;
          const px = cx + 0.5;
          const pz = cz + 0.5;
          const s = Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
          const d = Math.hypot(px - (a.x + dx * s), pz - (a.z + dz * s));
          // Smoothstep: clamp first (the cubic leaves [0, 1] outside it and would mark far cells).
          const e = Math.min(1, Math.max(0, (d - (hw - ROAD_EDGE_INNER_M)) / (ROAD_EDGE_INNER_M + ROAD_EDGE_OUTER_M)));
          const border = Math.min(1, Math.min(px, pz, t.width - px, t.depth - pz) / ROAD_BORDER_FADE_M);
          const w = (1 - e * e * (3 - 2 * e)) * border * border * (3 - 2 * border);
          const i = (cz * t.width + cx) * CHANNELS + ROAD_CHANNEL;
          if (w > (weights[i] as number)) weights[i] = w;
        }
      }
    }
  }
}

/** Moss and leaf litter under crowns and hedges: anchors every tree at any distance. */
function stampUnderstory(t: TerrainData, weights: Float32Array, trees: readonly TreeInstance[], hedges: readonly HedgeLine[]): void {
  const raise = (cx: number, cz: number, w: number) => {
    if (cx < 0 || cz < 0 || cx >= t.width || cz >= t.depth) return;
    const i = (cz * t.width + cx) * CHANNELS + FOREST_CHANNEL;
    weights[i] = Math.max(weights[i] as number, w);
  };
  for (const tree of trees) {
    if (!CROWN_SPECIES.has(tree.species)) continue;
    const r = CANOPY_FLOOR_RADIUS_M * tree.scale;
    for (let cz = Math.floor(tree.position.z - r); cz <= Math.ceil(tree.position.z + r); cz++) {
      for (let cx = Math.floor(tree.position.x - r); cx <= Math.ceil(tree.position.x + r); cx++) {
        const d = Math.hypot(cx + 0.5 - tree.position.x, cz + 0.5 - tree.position.z);
        if (d < r) raise(cx, cz, CANOPY_FLOOR_WEIGHT * (1 - (d / r) ** 2));
      }
    }
  }
  for (const hedge of hedges) {
    if (hedge.kind !== 'hedge') continue;
    const xs = hedge.points.map((p) => p.x);
    const zs = hedge.points.map((p) => p.z);
    for (let cz = Math.floor(Math.min(...zs) - HEDGE_FLOOR_M); cz <= Math.ceil(Math.max(...zs) + HEDGE_FLOOR_M); cz++) {
      for (let cx = Math.floor(Math.min(...xs) - HEDGE_FLOOR_M); cx <= Math.ceil(Math.max(...xs) + HEDGE_FLOOR_M); cx++) {
        const d = projectOnPolyline({ x: cx + 0.5, z: cz + 0.5 }, hedge.points).distance;
        if (d < HEDGE_FLOOR_M) raise(cx, cz, HEDGE_FLOOR_WEIGHT * (1 - d / HEDGE_FLOOR_M));
      }
    }
  }
}

/** Raises `channel` around cells of `layer` (square neighbourhood of `radius` cells). */
function dilate(t: TerrainData, weights: Float32Array, layer: TerrainLayerId, channel: SplatChannel, radius: number, weight: number): void {
  for (let cz = 0; cz < t.depth; cz++) {
    for (let cx = 0; cx < t.width; cx++) {
      if (t.layers[cz * t.width + cx] !== layer) continue;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = cx + dx;
          const z = cz + dz;
          if (x < 0 || z < 0 || x >= t.width || z >= t.depth) continue;
          const i = (z * t.width + x) * CHANNELS + channel;
          weights[i] = Math.max(weights[i] as number, weight);
        }
      }
    }
  }
}

export function buildSplatTexture(t: TerrainData, trees: readonly TreeInstance[] = [], hedges: readonly HedgeLine[] = [], roads: readonly RoadLine[] = []): DataTexture {
  let weights = new Float32Array(t.width * t.depth * CHANNELS);
  const analyticRoads = roads.length > 0;
  for (let i = 0; i < t.width * t.depth; i++) {
    const layer = t.layers[i] as TerrainLayerId;
    // With centrelines at hand, roads come from their exact distance (stampRoads).
    if (analyticRoads && layer === TerrainLayer.Road) continue;
    const channel = LAYER_CHANNEL[layer];
    if (channel !== undefined) weights[i * CHANNELS + channel] = 1;
  }
  stampRoads(t, weights, roads);
  // Analytic roads already carry their soft verge: keep them out of the blur (copied before the
  // building aprons, which must blur).
  const roadChannel = analyticRoads ? weights.filter((_, i) => i % CHANNELS === ROAD_CHANNEL) : null;
  // Anchoring: nothing stands on untouched lawn (brief §5.2 "objets sans ancrage").
  dilate(t, weights, TerrainLayer.Building, 0, APRON_CELLS, APRON_WEIGHT);
  dilate(t, weights, TerrainLayer.Wall, 2, WALL_FOOT_CELLS, WALL_FOOT_WEIGHT);
  stampUnderstory(t, weights, trees, hedges);
  for (let pass = 0; pass < BLUR_PASSES; pass++) weights = boxBlur(weights, t.width, t.depth);
  if (roadChannel) {
    const blurred = weights.filter((_, i) => i % CHANNELS === ROAD_CHANNEL);
    // Blurred aprons and verges: keep the larger of the sharp road and the blurred channel.
    roadChannel.forEach((w, i) => (weights[i * CHANNELS + ROAD_CHANNEL] = Math.max(w, blurred[i] as number)));
  }
  const bytes = new Uint8Array(weights.length);
  for (let i = 0; i < weights.length; i++) bytes[i] = Math.round(Math.min(1, weights[i] as number) * BYTE_MAX);
  const tex = new DataTexture(bytes, t.width, t.depth, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = 'TerrainSplat';
  return tex;
}

export function buildHeightTexture(t: TerrainData): DataTexture {
  const w = t.width + 1;
  const d = t.depth + 1;
  const data = new Uint16Array(w * d);
  for (let i = 0; i < data.length; i++) data[i] = DataUtils.toHalfFloat(t.heights[i] as number);
  const tex = new DataTexture(data, w, d, RedFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = 'TerrainHeights';
  return tex;
}
