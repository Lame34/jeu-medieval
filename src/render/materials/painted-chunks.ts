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
    p = p * 2.03 + vec2(17.1, 9.7);
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

/** Atmospheric perspective: sun-oriented fog colour, distance from camera, valley haze. */
export const PAINTED_FOG_FN = /* glsl */ `
vec3 paintedApplyFog(vec3 color, vec3 worldPos) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 viewDir = toFrag / max(dist, 1e-4);
  float sunAmount = pow(clamp(dot(viewDir, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 fogColor = mix(uFogAway, uFogSun, sunAmount);
  float fogF = uFogMax * smoothstep(uFogStart, uFogEnd, dist);
  float valley = uValleyFog * (1.0 - smoothstep(uValleyLow, uValleyHigh, worldPos.y)) * smoothstep(0.0, uFogStart, dist);
  return mix(color, fogColor, max(fogF, valley));
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
  paintedSunLit = max(paintedSunLit, vis);
  reflectedLight.directDiffuse += vis * directLight.color * BRDF_Lambert(material.diffuseColor);
}

void RE_IndirectDiffuse_Painted(const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  vec3 tint = mix(uShadowTint, vec3(1.0), paintedSunLit);
  reflectedLight.indirectDiffuse += irradiance * tint * BRDF_Lambert(material.diffuseColor);
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
