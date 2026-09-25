/**
 * GPU textures derived from TerrainData:
 *  - splat (RGBA8, 1 texel per cell): R road, G field soil, B mud/wet banks, A forest floor —
 *    box-blurred so the shader can break the transitions with noise (never linear, never cut);
 *  - heights (R16F, corners): read by the water shader for depth-based colour and foam.
 */
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, RGBAFormat, ClampToEdgeWrapping, UnsignedByteType } from 'three';
import { TerrainLayer, type TerrainLayerId } from '../../core/rules/types.ts';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';

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

export function buildSplatTexture(t: TerrainData): DataTexture {
  let weights = new Float32Array(t.width * t.depth * CHANNELS);
  for (let i = 0; i < t.width * t.depth; i++) {
    const channel = LAYER_CHANNEL[t.layers[i] as TerrainLayerId];
    if (channel !== undefined) weights[i * CHANNELS + channel] = 1;
  }
  for (let pass = 0; pass < BLUR_PASSES; pass++) weights = boxBlur(weights, t.width, t.depth);
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
