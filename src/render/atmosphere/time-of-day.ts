/**
 * Light rigs for the three reference hours of STYLE_BIBLE §3, plus dawn, the blue hour and the
 * night (J5: battles run through the day, brief §9.11), interpolated for any hour around the
 * clock. The weather tempers a rig (rain: grey and soft; fog: pale and flat). Colours are sRGB
 * hex; conversion to linear happens when they are pushed into uniforms.
 */
import { Color } from 'three';
import type { Weather } from '../../core/battle/conditions.ts';

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
  /** Share of shade that turns to the shadow hue at constant luminance (review v13, #1). */
  readonly shadowHue: number;
  readonly fogSun: string;
  readonly fogAway: string;
  /** Grading: warmth of the split-tone (highlights) and overall saturation. */
  readonly gradeWarmth: number;
  readonly gradeSaturation: number;
  readonly exposure: number;
}

/** Night: a moonlit painted blue, readable, warm only where the torches burn. */
const NIGHT: Omit<LightRig, 'hour' | 'sunElevationDeg' | 'sunAzimuthDeg'> = {
  sunColor: '#b4c4ee',
  sunIntensity: 0.8,
  skyZenith: '#161c38',
  horizonSun: '#3a4270',
  horizonAway: '#2a3052',
  ambientSky: '#4a5890',
  ambientGround: '#2c2834',
  ambientIntensity: 1.7,
  shadowColor: '#222a58',
  shadowStrength: 0.32,
  shadowHue: 0.3,
  fogSun: '#36406a',
  fogAway: '#2a3254',
  gradeWarmth: -0.01,
  gradeSaturation: 0.85,
  exposure: 1.5,
};

export const LIGHT_RIGS: readonly LightRig[] = [
  { hour: 4, sunElevationDeg: 22, sunAzimuthDeg: 140, ...NIGHT },
  {
    hour: 6.5,
    sunElevationDeg: 4,
    sunAzimuthDeg: 95,
    sunColor: '#ffb98a',
    sunIntensity: 1.6,
    skyZenith: '#5b6f9c',
    horizonSun: '#f0b48a',
    horizonAway: '#9a9fb8',
    ambientSky: '#8a94bc',
    ambientGround: '#5e5040',
    ambientIntensity: 2.0,
    shadowColor: '#4a5486',
    shadowStrength: 0.24,
    shadowHue: 0.24,
    fogSun: '#e0b090',
    fogAway: '#8d93ac',
    gradeWarmth: 0.05,
    gradeSaturation: 0.98,
    exposure: 1.1,
  },
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
    ambientGround: '#7a6a4c',
    ambientIntensity: 1.9,
    shadowColor: '#5f6c98',
    shadowStrength: 0.25,
    shadowHue: 0.22,
    fogSun: '#e8d4b4',
    fogAway: '#a9b9cc',
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
    horizonAway: '#c0c4ca',
    ambientSky: '#a4b8d8',
    ambientGround: '#7a6242',
    ambientIntensity: 1.9,
    shadowColor: '#55618f',
    shadowStrength: 0.28,
    shadowHue: 0.28,
    fogSun: '#ebc896',
    fogAway: '#a2aebe',
    gradeWarmth: 0.045,
    gradeSaturation: 1.0,
    exposure: 1.0,
  },
  {
    hour: 19.5,
    sunElevationDeg: 6,
    sunAzimuthDeg: 285,
    sunColor: '#ffb47a',
    sunIntensity: 2.2,
    skyZenith: '#4c5a8c',
    horizonSun: '#f29a62',
    horizonAway: '#8a7fa0',
    ambientSky: '#7d84b4',
    ambientGround: '#74523a',
    ambientIntensity: 2.3,
    shadowColor: '#444e80',
    shadowStrength: 0.24,
    shadowHue: 0.24,
    fogSun: '#e39a6c',
    fogAway: '#7e7896',
    gradeWarmth: 0.06,
    gradeSaturation: 1.0,
    exposure: 1.15,
  },
  {
    // The blue hour: the moon rises where the sun set.
    hour: 21,
    sunElevationDeg: 14,
    sunAzimuthDeg: 260,
    sunColor: '#a9b8e8',
    sunIntensity: 0.9,
    skyZenith: '#27305a',
    horizonSun: '#5a5a8a',
    horizonAway: '#3a4068',
    ambientSky: '#5a679c',
    ambientGround: '#3a3440',
    ambientIntensity: 1.9,
    shadowColor: '#2c3466',
    shadowStrength: 0.3,
    shadowHue: 0.3,
    fogSun: '#4e5680',
    fogAway: '#3a4064',
    gradeWarmth: 0,
    gradeSaturation: 0.9,
    exposure: 1.35,
  },
  { hour: 23, sunElevationDeg: 32, sunAzimuthDeg: 210, ...NIGHT },
];

/** The weather's cast over a rig: colours drawn towards a grey (scaled to the hour's light), factors. */
interface WeatherCast {
  readonly grey: string;
  readonly toward: number;
  readonly sun: number;
  readonly ambient: number;
  readonly shadow: number;
  readonly saturation: number;
  readonly warmth: number;
}
const WEATHER_CAST: Readonly<Record<Exclude<Weather, 'clear'>, WeatherCast>> = {
  rain: { grey: '#9aa2ac', toward: 0.65, sun: 0.45, ambient: 1.05, shadow: 0.6, saturation: 0.85, warmth: 0.3 },
  fog: { grey: '#c4c8cc', toward: 0.7, sun: 0.6, ambient: 1.1, shadow: 0.7, saturation: 0.85, warmth: 0.5 },
};
/** The day's horizon the weather greys are given for (they are dimmed with the hour's light). */
const CAST_REFERENCE = '#c0c4ca';

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
  readonly shadowHue: number;
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

/** The two rigs around `hour` (round the clock: after the last comes the first) and the blend. */
function bracket(hour: number): { a: LightRig; b: LightRig; t: number } {
  const h = ((hour % 24) + 24) % 24;
  const first = LIGHT_RIGS[0] as LightRig;
  const last = LIGHT_RIGS[LIGHT_RIGS.length - 1] as LightRig;
  if (h < first.hour || h >= last.hour) {
    const span = first.hour + 24 - last.hour;
    const since = h >= last.hour ? h - last.hour : h + 24 - last.hour;
    return { a: last, b: first, t: since / span };
  }
  for (let i = 0; i < LIGHT_RIGS.length - 1; i++) {
    const a = LIGHT_RIGS[i] as LightRig;
    const b = LIGHT_RIGS[i + 1] as LightRig;
    if (h >= a.hour && h <= b.hour) return { a, b, t: (h - a.hour) / (b.hour - a.hour) };
  }
  return { a: last, b: last, t: 0 };
}

/** Azimuths blend the short way round. */
function mixAngleDeg(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

/** Luminance of a linear colour. */
function luminance(c: Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** A rig under the weather (clear leaves it as it is). */
function withWeather(rig: ResolvedRig, weather: Weather): ResolvedRig {
  if (weather === 'clear') return rig;
  const cast = WEATHER_CAST[weather];
  const grey = new Color(cast.grey).multiplyScalar(luminance(rig.horizonAway) / luminance(new Color(CAST_REFERENCE)));
  const toward = (c: Color, k = cast.toward) => c.clone().lerp(grey, k);
  return {
    ...rig,
    sunColor: toward(rig.sunColor, cast.toward * 0.6),
    sunIntensity: rig.sunIntensity * cast.sun,
    skyZenith: toward(rig.skyZenith),
    horizonSun: toward(rig.horizonSun),
    horizonAway: toward(rig.horizonAway),
    ambientSky: toward(rig.ambientSky, cast.toward * 0.5),
    ambientIntensity: rig.ambientIntensity * cast.ambient,
    shadowStrength: rig.shadowStrength * cast.shadow,
    fogSun: toward(rig.fogSun),
    fogAway: toward(rig.fogAway),
    gradeSaturation: rig.gradeSaturation * cast.saturation,
    gradeWarmth: rig.gradeWarmth * cast.warmth,
  };
}

/** How dark it is (0: day, 1: night), for torches and the like: follows the rigs' exposure ramp. */
export function nightness(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  // Lights come up through the dusk and go out with the dawn.
  if (h >= 19 && h < 21) return (h - 19) / 2;
  if (h >= 21 || h < 5) return 1;
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
  return 0;
}

/** Direction pointing FROM the ground TOWARDS the sun (three.js y-up, azimuth from +z towards +x). */
export function sunDirection(elevationDeg: number, azimuthDeg: number): [number, number, number] {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

export function resolveRig(hour: number, weather: Weather = 'clear'): ResolvedRig {
  const { a, b, t } = bracket(hour);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return withWeather({
    sunDirection: sunDirection(mix(a.sunElevationDeg, b.sunElevationDeg), mixAngleDeg(a.sunAzimuthDeg, b.sunAzimuthDeg, t)),
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
    shadowHue: mix(a.shadowHue, b.shadowHue),
    fogSun: lerpColor(a.fogSun, b.fogSun, t),
    fogAway: lerpColor(a.fogAway, b.fogAway, t),
    gradeWarmth: mix(a.gradeWarmth, b.gradeWarmth),
    gradeSaturation: mix(a.gradeSaturation, b.gradeSaturation),
    exposure: mix(a.exposure, b.exposure),
  }, weather);
}
