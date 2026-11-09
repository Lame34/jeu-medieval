/**
 * The painted meadow's tones (ADR-055): one formula for the terrain's albedo and the grass blades,
 * so a blade far off takes exactly the colour of the ground under it and the carpet of blades has
 * neither an edge nor dark specks. Dry on the slopes, the ridges and the faces turned to the sun;
 * darker clover in the lush grass; a fine grain of value; the landscape's slow hue drift. The
 * shaders that include it also declare the painted globals and noise (uSunDir, paintedFbm…).
 */
import { Color } from 'three';
import type { SeasonPalette } from '../materials/season-palette.ts';

/** The painted light's wrap on the meadow, ground and blades alike. */
export const MEADOW_WRAP = 0.35;

export const MEADOW_TONE_PARS = /* glsl */ `
uniform vec3 uGrassLushLit;
uniform vec3 uGrassLushBase;
uniform vec3 uGrassDryLit;
uniform vec3 uGrassDryBase;
float meadowDryness(vec3 n, float nLarge, float heightAboveRef) {
  float slope = 1.0 - n.y;
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-5));
  float sunFacing = clamp(dot(n.xz, sunXZ) * 3.0, 0.0, 1.0) * clamp(slope * 4.0, 0.0, 1.0);
  return smoothstep(0.42, 0.8, nLarge + slope * 0.8 + sunFacing * 0.3 + heightAboveRef * 0.02);
}
vec3 meadowLush(float nMid) {
  return mix(uGrassLushBase, uGrassLushLit, 0.5 + 0.5 * nMid);
}
vec3 meadowDry(float nMid) {
  return mix(uGrassDryBase, uGrassDryLit, 0.45 + 0.55 * nMid);
}
/** The grass's lit tone where it is this dry (a blade's tip leans towards it). */
vec3 meadowLit(float dry) {
  return mix(uGrassLushLit, uGrassDryLit, dry * 0.85);
}
vec3 meadowTone(vec3 lush, vec3 dryC, float dry, vec2 xz, float nFine) {
  vec3 col = mix(lush, dryC, dry * 0.85);
  float clover = smoothstep(0.55, 0.75, paintedFbm(xz / 11.0 + 31.0));
  col = mix(col, max(paintedHueShift(col, 0.012), 0.0) * 0.86, clover * (1.0 - dry));
  return col * (0.9 + 0.2 * nFine);
}
vec3 landscapeHueDrift(vec3 col, float nLarge) {
  return max(paintedHueShift(col, (nLarge - 0.5) * 0.05), 0.0);
}
`;

/** The meadow's palette for MEADOW_TONE_PARS, from the season's. */
export function meadowUniforms(season: SeasonPalette): Record<string, { value: Color }> {
  return {
    uGrassLushLit: { value: new Color(season.grassLush.lit) },
    uGrassLushBase: { value: new Color(season.grassLush.base) },
    uGrassDryLit: { value: new Color(season.grassDry.lit) },
    uGrassDryBase: { value: new Color(season.grassDry.base) },
  };
}
