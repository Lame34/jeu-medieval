/**
 * Painted ground: a PaintedMaterial whose albedo is composed in the shader from the splat map,
 * slope (rock), exposure (dry grass) and three scales of world-space noise. No tiled textures:
 * the ground reads as gouache washes, never as a repeating photo.
 */
import { Color, Vector2, type Texture } from 'three';
import { PALETTE } from '../materials/palette.ts';
import { SEASON_PALETTES, type SeasonPalette } from '../materials/season-palette.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';
import { moveFieldUniforms } from '../battle/move-field.ts';

/** Movement contours: wash strengths inside the two zones, line half-width (px). */
const MOVE_WASH_INNER = 0.5;
const MOVE_WASH_OUTER = 0.35;
const MOVE_LINE_PX = 1.7;
const MOVE_INNER_COLOR = '#e6c35a';
const MOVE_OUTER_COLOR = '#f2e6c8';

/** Ring patchwork (m): parcels fade in past the map edge; rows, hedge width and far fade. */
const RING_PARCELS_FROM_M = 25;
const RING_PARCELS_FULL_M = 90;
const RING_ROW_M = 90;
const RING_HEDGE_WIDTH_M = 3;
const RING_HEDGE_FADE_M: readonly [number, number] = [1200, 2200];

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
  fieldBed = mix(fieldBed, cropMass, max(0.35, smoothstep(38.0, 55.0, distance(p.xz, uFocus.xz))));
  col = mix(col, fieldBed, wField * 0.9);
  // Where the GPU grass ends (uGrassRadius around the focus), the ground takes the blades'
  // average tone so the end of the carpet does not read.
  vec3 grassMass = mix(mix(uGrassLushBase, uGrassLushLit, 0.45) * 1.05, dryC, dry * 0.85);
  float prairie = (1.0 - wForest) * (1.0 - wField);
  col = mix(col, grassMass, 0.5 * prairie * smoothstep(0.6 * uGrassRadius, uGrassRadius, distance(p.xz, uFocus.xz)));
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

  #ifdef TERRAIN_RING
  col = terrainParcels(col, lush, dryC, p, nLarge, nFine, wForest);
  #else
  col = terrainMoveContours(col, p);
  #endif

  // Large painterly hue drift across the landscape.
  col = max(paintedHueShift(col, (nLarge - 0.5) * 0.05), 0.0);
  diffuseColor.rgb = col;
}
`;

/**
 * Map terrain only: the selected unit's movement area (render/battle/move-field.ts) as two
 * painted contours — gold for "move + act", parchment for "move only" — over light washes. The
 * AP-cost field is filtered bilinearly, so the outer line falls on the edge of the reachable
 * cells; derivatives keep both lines about 2.5 px wide, with a brush-like wobble.
 */
const MOVE_CONTOURS = /* glsl */ `
uniform sampler2D uMoveField;
uniform vec2 uMoveFieldOrigin;
uniform vec2 uMoveFieldSize;
uniform float uMoveInner;
uniform float uMoveOn;
uniform vec3 uMoveInnerColor;
uniform vec3 uMoveOuterColor;
vec3 terrainMoveContours(vec3 col, vec3 p) {
  if (uMoveOn < 0.5) return col;
  vec2 uv = (p.xz - uMoveFieldOrigin) / uMoveFieldSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return col;
  float cost = texture2D(uMoveField, uv).r * (255.0 / 254.0);
  float fw = max(fwidth(cost), 1e-4);
  float inner = 1.0 - smoothstep(uMoveInner - fw, uMoveInner + fw, cost);
  float outer = 1.0 - smoothstep(1.0 - fw, 1.0 + fw, cost);
  col = mix(col, col * vec3(1.07, 1.04, 0.94) + vec3(0.015, 0.012, 0.0), ${MOVE_WASH_INNER.toFixed(2)} * inner);
  col = mix(col, col * 1.04 + vec3(0.008), ${MOVE_WASH_OUTER.toFixed(2)} * (outer - inner));
  float wobble = 0.8 + 0.4 * paintedValueNoise(p.xz * 0.9);
  float lineInner = 1.0 - smoothstep(0.0, ${MOVE_LINE_PX.toFixed(2)} * wobble, abs(cost - uMoveInner) / fw);
  float lineOuter = 1.0 - smoothstep(0.0, ${MOVE_LINE_PX.toFixed(2)} * wobble, abs(cost - 1.0) / fw);
  col = mix(col, uMoveInnerColor, lineInner * 0.9);
  col = mix(col, uMoveOuterColor, lineOuter * 0.85);
  return col;
}
`;

/**
 * Decorative ring only: a patchwork of parcels (strips of 60–140 m in rows of 90 m, bent by a
 * low-frequency warp) in five tones, and hedgerows on about half of their borders, antialiased
 * with derivatives and faded out far away. Parcels start past the map edge so the seam keeps
 * the map's own ground.
 */
const RING_PARCELS = /* glsl */ `
uniform vec3 uParcelFallow;
uniform vec3 uParcelRye;
uniform vec3 uHedgeRow;
vec3 terrainParcels(vec3 col, vec3 lush, vec3 dryC, vec3 p, float nLarge, float nFine, float wForest) {
  vec2 outsideMap = max(max(uMapMin - p.xz, p.xz - uMapMax), 0.0);
  float amount = smoothstep(${RING_PARCELS_FROM_M.toFixed(1)}, ${RING_PARCELS_FULL_M.toFixed(1)}, length(outsideMap)) * (1.0 - wForest);
  if (amount <= 0.0) return col;
  vec2 warp = vec2(nLarge - 0.5, paintedValueNoise(p.xz / 170.0 + 7.0) - 0.5) * 70.0;
  vec2 q = mat2(0.94, -0.34, 0.34, 0.94) * (p.xz + warp);
  float row = floor(q.y / ${RING_ROW_M.toFixed(1)});
  float width = mix(60.0, 140.0, paintedHash12(vec2(row, 3.1)));
  float x = q.x + paintedHash12(vec2(row, 9.7)) * 200.0;
  float cell = floor(x / width);
  float h = paintedHash12(vec2(cell, row) + 0.37);
  vec3 wheat = mix(uWheatBase, uWheatLit, 0.6);
  vec3 parcel = h < 0.35 ? col : h < 0.55 ? dryC : h < 0.7 ? uParcelFallow : h < 0.85 ? mix(col, wheat, 0.6) : uParcelRye;
  parcel *= 0.94 + 0.12 * nFine;
  // Hedgerows: distance to the nearest border of the strip, on about half of the borders.
  vec2 local = vec2(fract(x / width) * width, fract(q.y / ${RING_ROW_M.toFixed(1)}) * ${RING_ROW_M.toFixed(1)});
  float edgeX = min(local.x, width - local.x);
  float edgeY = min(local.y, ${RING_ROW_M.toFixed(1)} - local.y);
  float keepX = step(0.5, paintedHash12(vec2(cell + step(width * 0.5, local.x), row) + 5.3));
  float keepY = step(0.5, paintedHash12(vec2(cell, row + step(${(RING_ROW_M / 2).toFixed(1)}, local.y)) + 8.1));
  float halfW = ${(RING_HEDGE_WIDTH_M / 2).toFixed(2)};
  float fx = fwidth(edgeX) + 1e-3;
  float fy = fwidth(edgeY) + 1e-3;
  float hedge = max(keepX * (1.0 - smoothstep(halfW - fx, halfW + fx, edgeX)), keepY * (1.0 - smoothstep(halfW - fy, halfW + fy, edgeY)));
  hedge *= 1.0 - smoothstep(${RING_HEDGE_FADE_M[0].toFixed(1)}, ${RING_HEDGE_FADE_M[1].toFixed(1)}, distance(cameraPosition.xz, p.xz));
  parcel = mix(parcel, uHedgeRow * (0.9 + 0.2 * nFine), hedge * 0.85);
  return mix(col, parcel, amount);
}
`;

export function createTerrainMaterial(
  splat: Texture,
  sizeM: { x: number; z: number },
  heightRefM: number,
  originM: { x: number; z: number } = { x: 0, z: 0 },
  ring = false,
  season: SeasonPalette = SEASON_PALETTES.harvest,
): PaintedMaterial {
  const c = (hex: string) => ({ value: new Color(hex) });
  return createPaintedMaterial({
    name: 'Terrain',
    ground: true,
    worldNormal: true,
    wrap: 0.35,
    customAlbedo: {
      key: ring ? 'terrain-ring-v1' : 'terrain-v2',
      pars: ring ? `#define TERRAIN_RING
${TERRAIN_PARS}${RING_PARCELS}` : `${TERRAIN_PARS}${MOVE_CONTOURS}`,
      body: TERRAIN_ALBEDO,
      uniforms: {
        uSplat: { value: splat },
        uSplatSize: { value: new Vector2(sizeM.x, sizeM.z) },
        uSplatOrigin: { value: new Vector2(originM.x, originM.z) },
        uHeightRef: { value: heightRefM },
        uGrassLushLit: c(season.grassLush.lit),
        uGrassLushBase: c(season.grassLush.base),
        uGrassDryLit: c(season.grassDry.lit),
        uGrassDryBase: c(season.grassDry.base),
        uMossLit: c(PALETTE.moss.lit),
        uMossBase: c(PALETTE.moss.base),
        uDirtLit: c(season.dirt.lit),
        uDirtBase: c(season.dirt.base),
        uPathLit: c(season.path.lit),
        uPathBase: c(season.path.base),
        uMudLit: c(season.mud.lit),
        uMudBase: c(season.mud.base),
        uStoneLit: c(PALETTE.stone.lit),
        uStoneBase: c(PALETTE.stone.base),
        uWheatBase: c(season.wheat.base),
        uWheatLit: c(season.wheat.lit),
        uFieldBed: c(season.fieldBed),
        uParcelFallow: c(season.fallow),
        uParcelRye: c(season.rye.lit),
        uHedgeRow: c(season.hedge),
        ...(ring ? {} : { ...moveFieldUniforms, uMoveInnerColor: c(MOVE_INNER_COLOR), uMoveOuterColor: c(MOVE_OUTER_COLOR) }),
      },
    },
  });
}
