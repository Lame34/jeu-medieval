/**
 * Uniforms shared by every painted shader (objects, terrain, water, sky). Materials receive
 * these exact objects by reference, so one update per frame reaches the whole scene.
 */
import { Color, DataTexture, RGBAFormat, Vector2, Vector3 } from 'three';

/** No torches: a black map (the shaders always have one bound). */
const NO_TORCHES = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat);
NO_TORCHES.needsUpdate = true;
import { resolveRig, type ResolvedRig } from '../atmosphere/time-of-day.ts';

/**
 * The shadow colour is normalised by its channel MEAN (not Rec.709 luminance, where blue weighs
 * 0.07 and would be boosted ×2), then each tint channel is clamped (art-director review v9, C1).
 */
const MIN_MEAN = 1e-4;
const TINT_MIN = 0.75;
const TINT_MAX = 1.25;


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
  maxAmount: 0.66,
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
  /** Strength of the shade hue rotation, the target hue (YIQ angle) and its chroma per luma. */
  uShadowHue: { value: 0 },
  uShadowHueAngle: { value: 0 },
  uShadowIQ: { value: new Vector2() },
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
  /** Radius of the GPU grass carpet around the focus (set by Grass). */
  uGrassRadius: { value: 40 },
  /** Camera focus point on the ground (grass radius, fog reference). */
  uFocus: { value: new Vector3() },
  /** Scene light level (≈ 1 at the reference afternoon): multiplies unlit shaders such as water. */
  uSceneLight: { value: new Color(1, 1, 1) },
  uExposure: { value: 1 },
  /** 0 under the rain (no cast shadows), 1 otherwise; the sun's strength over the afternoon's, 0–1. */
  uCastShadow: { value: 1 },
  uSunShare: { value: 1 },
  /** Playable map rectangle: fog thickens outside it so the map edge never reads. */
  uMapMin: { value: new Vector2(-1e6, -1e6) },
  uMapMax: { value: new Vector2(1e6, 1e6) },
  /** Torchlight baked over the battlefield (Torches.tsx), the metres it covers, its height scale; strength 0 by day. */
  uTorchMap: { value: NO_TORCHES },
  uTorchMapSize: { value: new Vector2(1, 1) },
  uTorchHeightRange: { value: 1 },
  uTorchStrength: { value: 0 },
  uTorchColor: { value: new Color('#ffa457') },
};

/** The sun intensity of the reference afternoon (the shade lift is full at it). */
const SUN_SHARE_REFERENCE = 2.5;

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
  const y = Math.max(0.299 * shadow.r + 0.587 * shadow.g + 0.114 * shadow.b, MIN_MEAN);
  const i = 0.596 * shadow.r - 0.274 * shadow.g - 0.322 * shadow.b;
  const q = 0.211 * shadow.r - 0.523 * shadow.g + 0.312 * shadow.b;
  g.uShadowHueAngle.value = Math.atan2(q, i);
  g.uShadowIQ.value.set(i / y, q / y);
  g.uShadowHue.value = rig.shadowHue;
  // Overall scene light relative to the reference afternoon: dims self-lit shaders (water).
  referenceLight ??= sceneLightOf(resolveRig(REFERENCE_HOUR));
  const light = sceneLightOf(rig);
  g.uSceneLight.value.setRGB(light.r / referenceLight.r, light.g / referenceLight.g, light.b / referenceLight.b);
  g.uExposure.value = rig.exposure;
  g.uSunShare.value = Math.min(1, Math.max(0, rig.sunIntensity / SUN_SHARE_REFERENCE));
  g.uFogSun.value.copy(rig.fogSun);
  g.uFogAway.value.copy(rig.fogAway);
  g.uSkyZenith.value.copy(rig.skyZenith);
  g.uHorizonSun.value.copy(rig.horizonSun);
  g.uHorizonAway.value.copy(rig.horizonAway);
}

/** Distance fog under each weather (rain and fog close it in; fog nearly hides the far map). */
export const WEATHER_FOG: Readonly<Record<'clear' | 'rain' | 'fog', FogSettings>> = {
  clear: DEFAULT_FOG,
  rain: { ...DEFAULT_FOG, startBeyondFocusM: 45, endBeyondFocusM: 520, maxAmount: 0.74 },
  fog: { ...DEFAULT_FOG, startBeyondFocusM: 6, endBeyondFocusM: 150, maxAmount: 0.9, valleyAmount: 0.25 },
};

/** An autumn morning's mist (ADR-052): thinner than the fog, it lets the castle show through. */
export const MIST_FOG: FogSettings = { ...DEFAULT_FOG, startBeyondFocusM: 18, endBeyondFocusM: 320, maxAmount: 0.8, valleyAmount: 0.3 };

/** The fog the camera anchors (Atmosphere sets it from the battle's weather). */
let activeFog: FogSettings = DEFAULT_FOG;

/** The battlefield's torchlight map, or none. */
export function setTorchMap(map: DataTexture | null, sizeM: Vector2 | null, heightRangeM: number): void {
  paintedGlobals.uTorchMap.value = map ?? NO_TORCHES;
  if (sizeM) paintedGlobals.uTorchMapSize.value.copy(sizeM);
  paintedGlobals.uTorchHeightRange.value = heightRangeM;
}

export function setActiveFog(fog: FogSettings): void {
  activeFog = fog;
  paintedGlobals.uFogMax.value = fog.maxAmount;
  paintedGlobals.uValleyFog.value = fog.valleyAmount;
}

/** Keeps the fog anchored to the camera focus: crisp foreground at every zoom level. */
export function updateFogForCamera(cameraToFocusM: number, fog: FogSettings = activeFog): void {
  paintedGlobals.uFogStart.value = cameraToFocusM + fog.startBeyondFocusM;
  paintedGlobals.uFogEnd.value = cameraToFocusM + fog.endBeyondFocusM;
}
