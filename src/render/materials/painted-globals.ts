/**
 * Uniforms shared by every painted shader (objects, terrain, water, sky). Materials receive
 * these exact objects by reference, so one update per frame reaches the whole scene.
 */
import { Color, Vector2, Vector3 } from 'three';
import { resolveRig, type ResolvedRig } from '../atmosphere/time-of-day.ts';

/**
 * The shadow colour is normalised by its channel MEAN (not Rec.709 luminance, where blue weighs
 * 0.07 and would be boosted ×2), then each tint channel is clamped (art-director review v9, C1).
 */
const MIN_MEAN = 1e-4;
const TINT_MIN = 0.75;
const TINT_MAX = 1.25;
/** Share of the rig's shadow hue kept in the constant-luminance shift. */
const SHADOW_HUE_SATURATION = 0.6;

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
  startBeyondFocusM: 70,
  endBeyondFocusM: 900,
  maxAmount: 0.72,
  valleyAmount: 0.12,
  valleyLowM: -2,
  valleyHighM: 3,
};

export const paintedGlobals = {
  uTime: { value: 0 },
  uSunDir: { value: new Vector3(0, 1, 0) },
  uSunColor: { value: new Color(1, 1, 1) },
  /** Luminance-preserving tint applied to ambient light where the sun does not reach. */
  uShadowTint: { value: new Vector3(1, 1, 1) },
  /** Shadow hue normalised to unit luminance, and the share of shade that takes it. */
  uShadowColor: { value: new Vector3(1, 1, 1) },
  uShadowHue: { value: 0 },
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
  /** Scene light level (≈ 1 at the reference afternoon): multiplies unlit shaders such as water. */
  uSceneLight: { value: new Color(1, 1, 1) },
  uExposure: { value: 1 },
  /** Playable map rectangle: fog thickens outside it so the map edge never reads. */
  uMapMin: { value: new Vector2(-1e6, -1e6) },
  uMapMax: { value: new Vector2(1e6, 1e6) },
};

/** Scene light = sun · sin(elevation) + weighted sky ambient, normalised by the 16:30 rig. */
const AMBIENT_WEIGHT = 0.5;
const REFERENCE_HOUR = 16.5;
let referenceLight: Color | null = null;

function sceneLightOf(rig: ResolvedRig): Color {
  const sunTerm = rig.sunIntensity * Math.max(0, rig.sunDirection[1]);
  return rig.sunColor
    .clone()
    .multiplyScalar(sunTerm)
    .add(rig.ambientSky.clone().multiplyScalar(rig.ambientIntensity * AMBIENT_WEIGHT));
}

export type PaintedGlobals = typeof paintedGlobals;

const scratchTint = new Vector3();

/** Pushes a light rig into the shared uniforms. */
export function applyRigToGlobals(rig: ResolvedRig): void {
  const g = paintedGlobals;
  g.uSunDir.value.set(rig.sunDirection[0], rig.sunDirection[1], rig.sunDirection[2]).normalize();
  g.uSunColor.value.copy(rig.sunColor);
  const shadow = rig.shadowColor;
  const mean = Math.max((shadow.r + shadow.g + shadow.b) / 3, MIN_MEAN);
  scratchTint.set(shadow.r / mean, shadow.g / mean, shadow.b / mean);
  g.uShadowTint.value.set(1, 1, 1).lerp(scratchTint, rig.shadowStrength);
  g.uShadowTint.value.clampScalar(TINT_MIN, TINT_MAX);
  const luminance = Math.max(0.2126 * shadow.r + 0.7152 * shadow.g + 0.0722 * shadow.b, MIN_MEAN);
  // Unit luminance, and only part of the hue: a fully saturated violet turns sunlit colours
  // (wheat, plaster) lavender in the shade.
  g.uShadowColor.value.set(shadow.r / luminance, shadow.g / luminance, shadow.b / luminance).lerp(scratchTint.set(1, 1, 1), 1 - SHADOW_HUE_SATURATION);
  g.uShadowHue.value = rig.shadowHue;
  // Overall scene light relative to the reference afternoon: dims self-lit shaders (water).
  referenceLight ??= sceneLightOf(resolveRig(REFERENCE_HOUR));
  const light = sceneLightOf(rig);
  g.uSceneLight.value.setRGB(light.r / referenceLight.r, light.g / referenceLight.g, light.b / referenceLight.b);
  g.uExposure.value = rig.exposure;
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
