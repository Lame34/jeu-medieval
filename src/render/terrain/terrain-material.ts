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
`;

const TERRAIN_ALBEDO = /* glsl */ `
{
  vec3 p = vPaintedWorldPos;
  vec3 n = normalize(vPaintedWorldNormal);
  vec4 w = texture2D(uSplat, (p.xz - uSplatOrigin) / uSplatSize);
  float slope = 1.0 - n.y;
  float nLarge = paintedFbm(p.xz / 38.0);
  float nMid = paintedFbm(p.xz / 7.0 + 7.3);
  float nFine = paintedValueNoise(p.xz * 1.9);
  float edgeNoise = (nMid - 0.5) * 0.55 + (nFine - 0.5) * 0.22;

  float dry = smoothstep(0.5, 0.88, nLarge + slope * 0.8 + (p.y - uHeightRef) * 0.02);
  vec3 lush = mix(uGrassLushBase, uGrassLushLit, 0.5 + 0.5 * nMid);
  vec3 dryC = mix(uGrassDryBase, uGrassDryLit, 0.45 + 0.55 * nMid);
  vec3 col = mix(lush, dryC, dry * 0.55);
  col *= 0.9 + 0.2 * nFine;

  float wForest = smoothstep(0.3, 0.7, w.a + edgeNoise);
  col = mix(col, mix(uMossBase, uMossLit, 0.35 + 0.5 * nMid), wForest * 0.9);
  float wField = smoothstep(0.35, 0.65, w.g + edgeNoise * 0.6);
  // Under the crop the ground reads as a golden straw bed, not as bare soil.
  vec3 fieldBed = mix(mix(uDirtBase, uDirtLit, 0.35 + 0.35 * nFine), uWheatBase, 0.6);
  col = mix(col, fieldBed, wField * 0.9);
  float wMud = smoothstep(0.28, 0.7, w.b + edgeNoise);
  col = mix(col, mix(uMudBase, uMudLit, 0.3 + 0.6 * nMid), wMud);
  float wRoad = smoothstep(0.32, 0.62, w.r + edgeNoise * 0.8);
  float ruts = smoothstep(0.3, 0.7, paintedValueNoise(p.xz * 1.3 + 3.7));
  vec3 road = mix(uPathBase, uPathLit, 0.4 + 0.4 * nMid) * (0.88 + 0.16 * ruts);
  col = mix(col, road, wRoad);

  float wRock = smoothstep(0.38, 0.6, slope + (nMid - 0.5) * 0.3);
  float strata = paintedFbm(vec2(p.x + p.z, p.y * 3.5) / 2.5);
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
      key: 'terrain-v1',
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
      },
    },
  });
}
