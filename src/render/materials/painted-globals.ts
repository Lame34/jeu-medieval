/**
 * Uniforms shared by every painted shader (objects, terrain, water, sky). Materials receive
 * these exact objects by reference, so one update per frame reaches the whole scene.
 */
import { Color, Vector2, Vector3 } from 'three';
import type { ResolvedRig } from '../atmosphere/time-of-day.ts';

/** Luminance weights (Rec. 709, linear). */
const LUMA = new Vector3(0.2126, 0.7152, 0.0722);
const MIN_LUMA = 1e-4;

export interface FogSettings {
  /** Fog starts this far beyond the camera→focus distance (m). */
  readonly startBeyondFocusM: number;
  /** Fog reaches `maxAmount` this far beyond the camera→focus distance (m). */
  readonly endBeyondFocusM: number;
  readonly maxAmount: number;
  /** Extra haze in valleys below `valleyHighM`. */
  readonly valleyAmount: number;
  readonly valleyLowM: number;
  readonly valleyHighM: number;
}

export const DEFAULT_FOG: FogSettings = {
  startBeyondFocusM: 60,
  endBeyondFocusM: 900,
  maxAmount: 0.72,
  valleyAmount: 0.22,
  valleyLowM: -2,
  valleyHighM: 6,
};

export const paintedGlobals = {
  uTime: { value: 0 },
  uSunDir: { value: new Vector3(0, 1, 0) },
  uSunColor: { value: new Color(1, 1, 1) },
  /** Luminance-preserving tint applied to ambient light where the sun does not reach. */
  uShadowTint: { value: new Vector3(1, 1, 1) },
  uFogSun: { value: new Color() },
  uFogAway: { value: new Color() },
  uFogStart: { value: 120 },
  uFogEnd: { value: 1000 },
  uFogMax: { value: DEFAULT_FOG.maxAmount },
  uValleyFog: { value: DEFAULT_FOG.valleyAmount },
  uValleyLow: { value: DEFAULT_FOG.valleyLowM },
  uValleyHigh: { value: DEFAULT_FOG.valleyHighM },
  uSkyZenith: { value: new Color() },
  uHorizonSun: { value: new Color() },
  uHorizonAway: { value: new Color() },
  uWindDir: { value: new Vector2(1, 0.3).normalize() },
  uWindStrength: { value: 0.6 },
  /** Camera focus point on the ground (grass radius, fog reference). */
  uFocus: { value: new Vector3() },
};

export type PaintedGlobals = typeof paintedGlobals;

const scratchTint = new Vector3();

/** Pushes a light rig into the shared uniforms. */
export function applyRigToGlobals(rig: ResolvedRig): void {
  const g = paintedGlobals;
  g.uSunDir.value.set(rig.sunDirection[0], rig.sunDirection[1], rig.sunDirection[2]).normalize();
  g.uSunColor.value.copy(rig.sunColor);
  const shadow = rig.shadowColor;
  const luma = Math.max(shadow.r * LUMA.x + shadow.g * LUMA.y + shadow.b * LUMA.z, MIN_LUMA);
  scratchTint.set(shadow.r / luma, shadow.g / luma, shadow.b / luma);
  g.uShadowTint.value.set(1, 1, 1).lerp(scratchTint, rig.shadowStrength);
  g.uFogSun.value.copy(rig.fogSun);
  g.uFogAway.value.copy(rig.fogAway);
  g.uSkyZenith.value.copy(rig.skyZenith);
  g.uHorizonSun.value.copy(rig.horizonSun);
  g.uHorizonAway.value.copy(rig.horizonAway);
}

/** Keeps the fog anchored to the camera focus: crisp foreground at every zoom level. */
export function updateFogForCamera(cameraToFocusM: number, fog: FogSettings = DEFAULT_FOG): void {
  paintedGlobals.uFogStart.value = cameraToFocusM + fog.startBeyondFocusM;
  paintedGlobals.uFogEnd.value = cameraToFocusM + fog.endBeyondFocusM;
}
