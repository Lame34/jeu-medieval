/**
 * Painted faction ring under each unit (brief §5.1 pillar "lisibilité tactique"): a soft,
 * brush-edged ring in the allegiance colour with an ink inner stroke, normal-blended (additive
 * blending turned red to orange on grass). Shape also encodes the side for colour-blind
 * players (attacker: full ring, defender: dashed). Rings grow with camera distance.
 */
import { Color, DoubleSide, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial } from 'three';
import type { Faction } from '../../core/rules/types.ts';
import { PALETTE } from '../materials/palette.ts';

const RING_SIZE_M = 2.2;
/** Ring scale = clamp(cameraDistance / RING_SCALE_DISTANCE_M, 1, RING_MAX_SCALE). */
export const RING_SCALE_DISTANCE_M = 60;
export const RING_MAX_SCALE = 1.8;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uInk;
uniform float uDashed;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  float angle = atan(d.y, d.x);
  float wobble = 0.03 * sin(angle * 7.0) + 0.02 * sin(angle * 13.0 + 1.3);
  float ring = smoothstep(0.62 + wobble, 0.7 + wobble, r) * (1.0 - smoothstep(0.86 + wobble, 0.95 + wobble, r));
  float ink = smoothstep(0.56 + wobble, 0.62 + wobble, r) * (1.0 - smoothstep(0.62 + wobble, 0.67 + wobble, r));
  float dash = mix(1.0, step(0.5, fract(angle / 6.2831853 * 10.0)), uDashed);
  float brush = 0.8 + 0.2 * hash(floor(vec2(angle * 20.0, r * 8.0)));
  float alpha = max(ring * dash * brush * 0.85, ink * dash * 0.45);
  if (alpha < 0.01) discard;
  vec3 color = mix(uColor, uInk, ink * (1.0 - ring));
  gl_FragColor = vec4(color, alpha);
}
`;

const geometry = new PlaneGeometry(RING_SIZE_M, RING_SIZE_M);
geometry.rotateX(-Math.PI / 2);

const materials: Partial<Record<Faction, ShaderMaterial>> = {};

function ringMaterial(faction: Faction): ShaderMaterial {
  const existing = materials[faction];
  if (existing) return existing;
  const color = new Color(faction === 'attacker' ? PALETTE.attacker.primary : PALETTE.defender.primary);
  const material = new ShaderMaterial({
    uniforms: { uColor: { value: color }, uInk: { value: new Color('#1c1a24') }, uDashed: { value: faction === 'defender' ? 1 : 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  materials[faction] = material;
  return material;
}

export function createFactionRing(faction: Faction): Mesh {
  const mesh = new Mesh(geometry, ringMaterial(faction));
  mesh.name = `FactionRing:${faction}`;
  mesh.renderOrder = 5;
  mesh.position.y = 0.06;
  return mesh;
}
