/**
 * Painted ground: a PaintedMaterial whose albedo is composed in the shader from the splat map,
 * slope (rock), exposure (dry grass) and three scales of world-space noise. No tiled textures:
 * the ground reads as gouache washes, never as a repeating photo.
 */
import { Color, Vector2, type Texture } from 'three';
import { PALETTE } from '../materials/palette.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';

const TERRAIN_PARS = /* glsl */ `
uniform sampler2D uSplat;
uniform vec2 uSplatSize;
uniform vec2 uSplatOrigin;
uniform float uHeightRef;
uniform vec3 uGrassLushLit;
uniform vec3 uGrassLushBase;
uniform vec3 uGrassDryLit;
uniform vec3 uGrassDryBase;
uniform vec3 uMossLit;
uniform vec3 uMossBase;
uniform vec3 uDirtLit;
uniform vec3 uDirtBase;
uniform vec3 uPathLit;
uniform vec3 uPathBase;
uniform vec3 uMudLit;
uniform vec3 uMudBase;
uniform vec3 uStoneLit;
uniform vec3 uStoneBase;
uniform vec3 uWheatBase;
uniform vec3 uWheatLit;
uniform vec3 uFieldBed;
// Triplanar blend weights: steep banks (moats, butte) sample their detail noise on the vertical
// planes instead of stretching the ground projection.
vec3 terrainTriWeights(vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  return w / (w.x + w.y + w.z);
}
float terrainTriFbm(vec3 p, vec3 w, float scale, float offset) {
  float v = paintedFbm(p.xz / scale + offset) * w.y;
  if (w.y < 0.98) v += paintedFbm(p.zy / scale + offset) * w.x + paintedFbm(p.xy / scale + offset) * w.z;
  else v /= w.y;
  return v;
}
float terrainTriValue(vec3 p, vec3 w, float freq) {
  float v = paintedValueNoise(p.xz * freq) * w.y;
  if (w.y < 0.98) v += paintedValueNoise(p.zy * freq) * w.x + paintedValueNoise(p.xy * freq) * w.z;
  else v /= w.y;
  return v;
}
`;

const TERRAIN_ALBEDO = /* glsl */ `
{
  vec3 p = vPaintedWorldPos;
  vec3 n = normalize(vPaintedWorldNormal);
  vec4 w = texture2D(uSplat, (p.xz - uSplatOrigin) / uSplatSize);
  float slope = 1.0 - n.y;
  float nLarge = paintedFbm(p.xz / 26.0);
  vec3 tri = terrainTriWeights(n);
  float nMid = terrainTriFbm(p, tri, 7.0, 7.3);
  float nFine = terrainTriValue(p, tri, 1.9);
  float edgeNoise = (nMid - 0.5) * 0.55 + (nFine - 0.5) * 0.22;

  // Slopes facing the sun dry out and blond; ridges too.
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-5));
  float sunFacing = clamp(dot(n.xz, sunXZ) * 3.0, 0.0, 1.0) * clamp(slope * 4.0, 0.0, 1.0);
  float dry = smoothstep(0.42, 0.8, nLarge + slope * 0.8 + sunFacing * 0.3 + (p.y - uHeightRef) * 0.02);
  vec3 lush = mix(uGrassLushBase, uGrassLushLit, 0.5 + 0.5 * nMid);
  vec3 dryC = mix(uGrassDryBase, uGrassDryLit, 0.45 + 0.55 * nMid);
  vec3 col = mix(lush, dryC, dry * 0.85);
  // Third tone: darker clover patches.
  float clover = smoothstep(0.55, 0.75, paintedFbm(p.xz / 11.0 + 31.0));
  col = mix(col, max(paintedHueShift(col, 0.012), 0.0) * 0.86, clover * (1.0 - dry));
  col *= 0.9 + 0.2 * nFine;

  float wForest = smoothstep(0.3, 0.7, w.a + edgeNoise);
  col = mix(col, mix(uMossBase, uMossLit, 0.35 + 0.5 * nMid), wForest * 0.9);
  float wField = smoothstep(0.35, 0.65, w.g + edgeNoise);
  // Under the crop the ground reads as a golden straw bed, not as bare soil.
  // Stubble tone close to the crop: sparse distant tufts (and the unstreamed far fields) keep their mass.
  vec3 fieldBed = uFieldBed * (0.88 + 0.24 * nFine) * (0.94 + 0.12 * nMid);
  // Beyond the streamed tufts (WheatField, 72 m around the focus) the bed carries the crop
  // itself: the ripe mass, not the shade between the stalks.
  vec3 cropMass = mix(uWheatBase, uWheatLit, 0.5 + 0.25 * nMid) * (0.92 + 0.16 * nFine);
  fieldBed = mix(fieldBed, cropMass, smoothstep(38.0, 55.0, distance(p.xz, uFocus.xz)));
  col = mix(col, fieldBed, wField * 0.9);
  float wMud = smoothstep(0.28, 0.7, w.b + edgeNoise);
  col = mix(col, mix(uMudBase, uMudLit, 0.3 + 0.6 * nMid), wMud);
  // Width wanders ±0.4 m with the large-scale noise; ragged edges.
  float wRoad = smoothstep(0.4, 0.6, w.r + edgeNoise * 0.5 + (nLarge - 0.5) * 0.25);
  // Ruts and wear along a rotated frame: no axis-aligned pixel pattern.
  float ruts = paintedFbm(mat2(0.8, -0.6, 0.6, 0.8) * p.xz / 1.8);
  vec3 road = mix(uPathBase, uPathLit, 0.4 + 0.4 * nMid) * (0.86 + 0.2 * ruts);
  col = mix(col, road, wRoad);

  float wRock = smoothstep(0.38, 0.6, slope + (nMid - 0.5) * 0.3);
  // Horizontal strata, projected like the detail noise (no vertical smearing on steep faces).
  float strata = terrainTriFbm(vec3(p.x, p.y * 3.5, p.z), tri, 2.5, 0.0);
  vec3 rock = mix(uStoneBase, uStoneLit, 0.25 + 0.6 * strata);
  col = mix(col, rock, wRock);

  // Large painterly hue drift across the landscape.
  col = max(paintedHueShift(col, (nLarge - 0.5) * 0.05), 0.0);
  diffuseColor.rgb = col;
}
`;

export function createTerrainMaterial(
  splat: Texture,
  sizeM: { x: number; z: number },
  heightRefM: number,
  originM: { x: number; z: number } = { x: 0, z: 0 },
): PaintedMaterial {
  const c = (hex: string) => ({ value: new Color(hex) });
  return createPaintedMaterial({
    name: 'Terrain',
    worldNormal: true,
    wrap: 0.35,
    customAlbedo: {
      key: 'terrain-v2',
      pars: TERRAIN_PARS,
      body: TERRAIN_ALBEDO,
      uniforms: {
        uSplat: { value: splat },
        uSplatSize: { value: new Vector2(sizeM.x, sizeM.z) },
        uSplatOrigin: { value: new Vector2(originM.x, originM.z) },
        uHeightRef: { value: heightRefM },
        uGrassLushLit: c(PALETTE.grassLush.lit),
        uGrassLushBase: c(PALETTE.grassLush.base),
        uGrassDryLit: c(PALETTE.grassDry.lit),
        uGrassDryBase: c(PALETTE.grassDry.base),
        uMossLit: c(PALETTE.moss.lit),
        uMossBase: c(PALETTE.moss.base),
        uDirtLit: c(PALETTE.dirt.lit),
        uDirtBase: c(PALETTE.dirt.base),
        uPathLit: c(PALETTE.path.lit),
        uPathBase: c(PALETTE.path.base),
        uMudLit: c(PALETTE.mud.lit),
        uMudBase: c(PALETTE.mud.base),
        uStoneLit: c(PALETTE.stone.lit),
        uStoneBase: c(PALETTE.stone.base),
        uWheatBase: c(PALETTE.wheat.base),
        uWheatLit: c(PALETTE.wheat.lit),
        uFieldBed: c(PALETTE.fieldBed),
      },
    },
  });
}
