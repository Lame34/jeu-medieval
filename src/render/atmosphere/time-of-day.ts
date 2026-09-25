/**
 * Light rigs for the three reference hours of STYLE_BIBLE §3, interpolated for any hour.
 * Colours are sRGB hex; conversion to linear happens when they are pushed into uniforms.
 */
import { Color } from 'three';

export interface LightRig {
  readonly hour: number;
  readonly sunElevationDeg: number;
  readonly sunAzimuthDeg: number;
  readonly sunColor: string;
  readonly sunIntensity: number;
  readonly skyZenith: string;
  readonly horizonSun: string;
  readonly horizonAway: string;
  readonly ambientSky: string;
  readonly ambientGround: string;
  readonly ambientIntensity: number;
  readonly shadowColor: string;
  readonly shadowStrength: number;
  readonly fogSun: string;
  readonly fogAway: string;
  /** Grading: warmth of the split-tone (highlights) and overall saturation. */
  readonly gradeWarmth: number;
  readonly gradeSaturation: number;
  readonly exposure: number;
}

export const LIGHT_RIGS: readonly LightRig[] = [
  {
    hour: 8,
    sunElevationDeg: 18,
    sunAzimuthDeg: 110,
    sunColor: '#ffe7c8',
    sunIntensity: 2.3,
    skyZenith: '#7fa6cf',
    horizonSun: '#f4e2c4',
    horizonAway: '#c5d3df',
    ambientSky: '#aec0dc',
    ambientGround: '#6e6450',
    ambientIntensity: 1.9,
    shadowColor: '#5f6c98',
    shadowStrength: 0.66,
    fogSun: '#e8dcc6',
    fogAway: '#b4c3d2',
    gradeWarmth: 0.03,
    gradeSaturation: 1.02,
    exposure: 1.0,
  },
  {
    hour: 16.5,
    sunElevationDeg: 24,
    sunAzimuthDeg: 245,
    sunColor: '#ffd8a6',
    sunIntensity: 2.5,
    skyZenith: '#6f96c4',
    horizonSun: '#f3d09c',
    horizonAway: '#b8c6d4',
    ambientSky: '#a4b8d8',
    ambientGround: '#7a6242',
    ambientIntensity: 1.9,
    shadowColor: '#5b5a8e',
    shadowStrength: 0.72,
    fogSun: '#ebc896',
    fogAway: '#a8b8ca',
    gradeWarmth: 0.045,
    gradeSaturation: 1.05,
    exposure: 1.0,
  },
  {
    hour: 19.5,
    sunElevationDeg: 6,
    sunAzimuthDeg: 285,
    sunColor: '#ff9a58',
    sunIntensity: 1.8,
    skyZenith: '#4c5a8c',
    horizonSun: '#f29a62',
    horizonAway: '#8a7fa0',
    ambientSky: '#8284b0',
    ambientGround: '#6a4a3a',
    ambientIntensity: 2.1,
    shadowColor: '#4a4278',
    shadowStrength: 0.6,
    fogSun: '#e39a6c',
    fogAway: '#7e7896',
    gradeWarmth: 0.08,
    gradeSaturation: 1.0,
    exposure: 1.1,
  },
];

export interface ResolvedRig {
  readonly sunDirection: readonly [number, number, number];
  readonly sunColor: Color;
  readonly sunIntensity: number;
  readonly skyZenith: Color;
  readonly horizonSun: Color;
  readonly horizonAway: Color;
  readonly ambientSky: Color;
  readonly ambientGround: Color;
  readonly ambientIntensity: number;
  readonly shadowColor: Color;
  readonly shadowStrength: number;
  readonly fogSun: Color;
  readonly fogAway: Color;
  readonly gradeWarmth: number;
  readonly gradeSaturation: number;
  readonly exposure: number;
}

const DEG = Math.PI / 180;

function lerpColor(a: string, b: string, t: number): Color {
  // Interpolate in linear space (Color.set converts sRGB hex to the linear working space).
  return new Color(a).lerp(new Color(b), t);
}

function bracket(hour: number): { a: LightRig; b: LightRig; t: number } {
  const first = LIGHT_RIGS[0] as LightRig;
  const last = LIGHT_RIGS[LIGHT_RIGS.length - 1] as LightRig;
  if (hour <= first.hour) return { a: first, b: first, t: 0 };
  if (hour >= last.hour) return { a: last, b: last, t: 0 };
  for (let i = 0; i < LIGHT_RIGS.length - 1; i++) {
    const a = LIGHT_RIGS[i] as LightRig;
    const b = LIGHT_RIGS[i + 1] as LightRig;
    if (hour >= a.hour && hour <= b.hour) return { a, b, t: (hour - a.hour) / (b.hour - a.hour) };
  }
  return { a: last, b: last, t: 0 };
}

/** Direction pointing FROM the ground TOWARDS the sun (three.js y-up, azimuth from +z towards +x). */
export function sunDirection(elevationDeg: number, azimuthDeg: number): [number, number, number] {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

export function resolveRig(hour: number): ResolvedRig {
  const { a, b, t } = bracket(hour);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    sunDirection: sunDirection(mix(a.sunElevationDeg, b.sunElevationDeg), mix(a.sunAzimuthDeg, b.sunAzimuthDeg)),
    sunColor: lerpColor(a.sunColor, b.sunColor, t),
    sunIntensity: mix(a.sunIntensity, b.sunIntensity),
    skyZenith: lerpColor(a.skyZenith, b.skyZenith, t),
    horizonSun: lerpColor(a.horizonSun, b.horizonSun, t),
    horizonAway: lerpColor(a.horizonAway, b.horizonAway, t),
    ambientSky: lerpColor(a.ambientSky, b.ambientSky, t),
    ambientGround: lerpColor(a.ambientGround, b.ambientGround, t),
    ambientIntensity: mix(a.ambientIntensity, b.ambientIntensity),
    shadowColor: lerpColor(a.shadowColor, b.shadowColor, t),
    shadowStrength: mix(a.shadowStrength, b.shadowStrength),
    fogSun: lerpColor(a.fogSun, b.fogSun, t),
    fogAway: lerpColor(a.fogAway, b.fogAway, t),
    gradeWarmth: mix(a.gradeWarmth, b.gradeWarmth),
    gradeSaturation: mix(a.gradeSaturation, b.gradeSaturation),
    exposure: mix(a.exposure, b.exposure),
  };
}
