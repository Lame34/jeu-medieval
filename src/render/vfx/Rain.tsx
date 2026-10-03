/**
 * Rain (J5, brief §9.11): pale streaks falling around the camera focus, slanted by the battle's
 * wind. One draw call; the fall is computed in the vertex shader (no per-frame CPU work beyond a
 * uniform), the volume wraps around the focus so it never runs out.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, LineSegments, ShaderMaterial } from 'three';
import { paintedGlobals } from '../materials/painted-globals.ts';

const DROPS = 2600;
/** The rain volume around the focus (m), the fall speed (m/s) and a streak's length (m). */
const VOLUME_M = { x: 70, y: 32, z: 70 } as const;
const FALL_MS = 14;
const STREAK_M = 0.7;
/** Horizontal drift per unit of wind strength (m/s). */
const WIND_DRIFT_MS = 4;
const RAIN_COLOR = '#c9d2dc';
const RAIN_ALPHA = 0.32;

const RAIN_VERTEX = /* glsl */ `
attribute vec4 aDrop; // x, y, z in the unit volume, end (0: head, 1: tail)
uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uVolume;
uniform vec2 uDrift;
uniform float uFall;
uniform float uStreak;
varying float vEnd;
varying float vDepth;
void main() {
  vEnd = aDrop.w;
  float y = fract(aDrop.y - uTime * uFall / uVolume.y);
  vec2 xz = fract(aDrop.xz + (uDrift * uTime) / uVolume.xz - uCentre.xz / uVolume.xz) - 0.5;
  vec3 p = vec3(uCentre.x + xz.x * uVolume.x, uCentre.y - 4.0 + y * uVolume.y, uCentre.z + xz.y * uVolume.z);
  // The tail trails up and upwind of the head.
  vec3 dir = normalize(vec3(uDrift.x, -uFall, uDrift.y));
  p -= dir * uStreak * aDrop.w;
  vec4 view = viewMatrix * vec4(p, 1.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vEnd;
varying float vDepth;
void main() {
  // Thin out with distance (no grey curtain far away) and towards the tail.
  float a = uAlpha * (1.0 - vEnd * 0.7) * (1.0 - smoothstep(25.0, 60.0, vDepth));
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/** Deterministic [0, 1) (no Math.random in the scene: the same rain on every run). */
function hash(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export function Rain({ windX, windZ, windStrength }: { readonly windX: number; readonly windZ: number; readonly windStrength: number }) {
  const lines = useMemo(() => {
    const drops = new Float32Array(DROPS * 2 * 4);
    for (let i = 0; i < DROPS; i++) {
      const x = hash(i, 1);
      const y = hash(i, 2);
      const z = hash(i, 3);
      drops.set([x, y, z, 0, x, y, z, 1], i * 8);
    }
    const g = new BufferGeometry();
    g.setAttribute('aDrop', new BufferAttribute(drops, 4));
    // Positions are computed in the shader; three still wants a position attribute.
    g.setAttribute('position', new BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
    const material = new ShaderMaterial({
      name: 'Rain',
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: paintedGlobals.uFocus.value.clone() },
        uVolume: { value: [VOLUME_M.x, VOLUME_M.y, VOLUME_M.z] },
        uDrift: { value: [0, 0] },
        uFall: { value: FALL_MS },
        uStreak: { value: STREAK_M },
        uColor: { value: new Color(RAIN_COLOR) },
        uAlpha: { value: RAIN_ALPHA },
      },
      transparent: true,
      depthWrite: false,
    });
    const l = new LineSegments(g, material);
    l.name = 'Rain';
    l.frustumCulled = false;
    l.renderOrder = 7;
    return l;
  }, []);

  useEffect(() => {
    const len = Math.hypot(windX, windZ) || 1;
    const u = (lines.material as ShaderMaterial).uniforms;
    (u['uDrift'] as { value: number[] }).value = [(windX / len) * WIND_DRIFT_MS * windStrength, (windZ / len) * WIND_DRIFT_MS * windStrength];
  }, [lines, windX, windZ, windStrength]);

  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as ShaderMaterial).dispose();
    },
    [lines],
  );

  useFrame((_, delta) => {
    const u = (lines.material as ShaderMaterial).uniforms;
    (u['uTime'] as { value: number }).value += Math.min(delta, 0.1);
    (u['uCentre'] as { value: { copy(v: unknown): void } }).value.copy(paintedGlobals.uFocus.value);
  });

  return <primitive object={lines} />;
}
