/**
 * GLSL building blocks of the painted look. Injected into three's MeshLambertMaterial by
 * painted-material.ts; also reused verbatim by the terrain, water and sky shaders so that the
 * whole scene shares one lighting and atmosphere model.
 */
import { ShaderChunk } from 'three';

/** Uniform declarations for the shared globals (see painted-globals.ts). */
export const PAINTED_GLOBALS_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadowTint;
uniform float uShadowHue;
uniform float uShadowHueAngle;
uniform vec2 uShadowIQ;
uniform vec3 uFogSun;
uniform vec3 uFogAway;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uFogMax;
uniform float uValleyFog;
uniform float uValleyLow;
uniform float uValleyHigh;
uniform vec3 uSkyZenith;
uniform vec3 uHorizonSun;
uniform vec3 uHorizonAway;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uFocus;
uniform vec3 uSceneLight;
uniform float uExposure;
uniform vec2 uMapMin;
uniform vec2 uMapMax;
`;

/** Cheap hash/value-noise helpers (no sin-based hash: stable across GPUs). */
export const PAINTED_NOISE = /* glsl */ `
float paintedHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float paintedValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = paintedHash12(i);
  float b = paintedHash12(i + vec2(1.0, 0.0));
  float c = paintedHash12(i + vec2(0.0, 1.0));
  float d = paintedHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float paintedFbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * paintedValueNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return v / 0.875;
}
vec3 paintedHueShift(vec3 c, float turns) {
  const vec3 k = vec3(0.57735026);
  float a = turns * 6.2831853;
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float paintedLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
`;

/**
 * Atmospheric perspective: sun-oriented fog colour, ease-out distance curve (the middle ground
 * already softens), valley haze, and extra haze beyond the playable map so its edge never reads.
 */
export const PAINTED_FOG_FN = /* glsl */ `
// Scene saturation ceiling (STYLE_BIBLE §2): only allegiance colours may exceed it. HSV
// saturation measured in approximate display space (sqrt of linear), value preserved.
vec3 paintedSaturationCeiling(vec3 c, float ceiling) {
  vec3 d = sqrt(max(c, 0.0));
  float mx = max(d.r, max(d.g, d.b));
  float s = mx > 1e-4 ? (mx - min(d.r, min(d.g, d.b))) / mx : 0.0;
  if (s > ceiling) d = mix(vec3(mx), d, ceiling / s);
  return d * d;
}
vec3 paintedApplyFog(vec3 color, vec3 worldPos) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 viewDir = toFrag / max(dist, 1e-4);
  float sunAmount = pow(clamp(dot(viewDir, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 fogColor = mix(uFogAway, uFogSun, sunAmount);
  float t = clamp((dist - uFogStart) / max(uFogEnd - uFogStart, 1.0), 0.0, 1.0);
  float fogF = uFogMax * (1.0 - (1.0 - t) * (1.0 - t));
  float valley = uValleyFog * (1.0 - smoothstep(uValleyLow, uValleyHigh, worldPos.y)) * smoothstep(0.0, uFogStart, dist);
  vec2 outside = max(max(uMapMin - worldPos.xz, worldPos.xz - uMapMax), 0.0);
  // Stepped planes of haze beyond the map, not a milky wall (review v15).
  float edge = 0.25 * smoothstep(20.0, 240.0, length(outside));
  return mix(color, fogColor, max(max(fogF, valley), edge));
}
`;

/** Lambert lighting replaced by wrap lighting + tinted shadows. */
export const PAINTED_LIGHTS_PARS = /* glsl */ `
varying vec3 vViewPosition;
uniform float uWrap;
float paintedShadow = 1.0;
float paintedSunLit = 0.0;

struct LambertMaterial {
  vec3 diffuseColor;
  float specularStrength;
};

float paintedWrap(vec3 n, vec3 l) {
  return clamp((dot(n, l) + uWrap) / (1.0 + uWrap), 0.0, 1.0);
}

void RE_Direct_Painted(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  float vis = paintedWrap(geometryNormal, directLight.direction);
  reflectedLight.directDiffuse += vis * directLight.color * BRDF_Lambert(material.diffuseColor);
}

void RE_Direct_PaintedSun(const in IncidentLight directLight, const in vec3 geometryNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  float vis = paintedWrap(geometryNormal, directLight.direction) * paintedShadow;
  // "Is this surface in the sun?" — a narrow step around the terminator, not the wrap term:
  // flat ground under a grazing sun must stay neutral, only true shade takes the tint.
  paintedSunLit = max(paintedSunLit, paintedShadow * smoothstep(-0.1, 0.1, dot(geometryNormal, directLight.direction)));
  reflectedLight.directDiffuse += vis * directLight.color * BRDF_Lambert(material.diffuseColor);
}

void RE_IndirectDiffuse_Painted(const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  vec3 tint = mix(uShadowTint, vec3(1.0), paintedSunLit);
  // Warm albedos (earth, straw, tiles) in the shade: neutral-ish bounce light, gentler tint —
  // otherwise the blue sky light greys them or turns them mauve (review v17).
  vec3 albedoYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * material.diffuseColor;
  float warmAlbedo = smoothstep(0.0, 0.03, albedoYiq.y) * (1.0 - paintedSunLit);
  vec3 light = mix(irradiance, vec3(dot(irradiance, vec3(1.0 / 3.0))), 0.4 * warmAlbedo);
  tint = mix(tint, vec3(1.0), 0.5 * warmAlbedo);
  vec3 c = light * tint * BRDF_Lambert(material.diffuseColor);
  // Cast shadows as washes: a little more light than the plain ambient.
  c *= mix(1.1, 1.0, paintedSunLit);
  // Shade turns the hue towards blue-violet at constant luminance (YIQ rotation, at most
  // ~25°): wheat goes ochre, grass blue-green, plaster sienna, stone blue-violet. A straight
  // mix towards violet would pass through grey (review v15). Greys take the shadow chroma.
  float shade = (1.0 - paintedSunLit) * clamp(uShadowHue / 0.28, 0.0, 1.2);
  #ifdef PAINTED_ALLEGIANCE
  shade = 0.0; // allegiance colours never drift (a red tabard would turn magenta)
  #endif
  if (shade > 0.001) {
    vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c;
    float chroma = length(yiq.yz);
    float a = atan(yiq.z, yiq.y);
    float d = mod(uShadowHueAngle - a + 3.14159265, 6.28318531) - 3.14159265;
    // Cool hues turn towards the shadow hue (≤ 14°). Warm hues would reach it through magenta:
    // ochres and yellows (Q < 0) cool towards olive instead (≤ 10°), reds do not turn.
    float warm = smoothstep(0.0, 0.02, yiq.y);
    float warmTurn = yiq.z < 0.0 ? -0.17 : 0.0;
    a += mix(clamp(d, -0.25, 0.25), warmTurn, warm) * shade;
    yiq.yz = vec2(cos(a), sin(a)) * chroma * mix(1.0 - 0.1 * shade, 1.0, warm);
    yiq.yz += uShadowIQ * yiq.x * 0.25 * shade * (1.0 - smoothstep(0.02, 0.06, chroma));
    c = max(mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * yiq, 0.0);
  }
  reflectedLight.indirectDiffuse += c;
}

#define RE_Direct RE_Direct_Painted
#define RE_IndirectDiffuse RE_IndirectDiffuse_Painted
`;

const SUN_SHADOW_PATTERN = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow(';
const SUN_CALL_PATTERN = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const DIR_BLOCK_MARKER = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';

function replaceOnce(source: string, pattern: string, replacement: string, what: string): string {
  const index = source.indexOf(pattern);
  if (index < 0) throw new Error(`PaintedMaterial: three.js shader chunk changed (${what} not found). Update painted-chunks.ts.`);
  return source.slice(0, index) + replacement + source.slice(index + pattern.length);
}

/**
 * three's lights_fragment_begin with the directional (sun) loop patched: the shadow factor is
 * captured into `paintedShadow` instead of darkening the light colour, and the sun goes
 * through RE_Direct_PaintedSun. Throws at startup if a three.js update changed the chunk.
 */
export function buildPaintedLightsBegin(): string {
  const chunk = ShaderChunk.lights_fragment_begin;
  const start = chunk.indexOf(DIR_BLOCK_MARKER);
  if (start < 0) throw new Error('PaintedMaterial: directional light block not found in lights_fragment_begin.');
  let dirPart = chunk.slice(start);
  const hasShadowLine = dirPart.includes(SUN_SHADOW_PATTERN);
  if (hasShadowLine) dirPart = replaceOnce(dirPart, SUN_SHADOW_PATTERN, 'paintedShadow = ( directLight.visible && receiveShadow ) ? getShadow(', 'sun shadow line');
  dirPart = replaceOnce(dirPart, SUN_CALL_PATTERN, 'RE_Direct_PaintedSun( directLight, geometryNormal, material, reflectedLight );', 'sun RE_Direct call');
  return chunk.slice(0, start) + dirPart;
}
