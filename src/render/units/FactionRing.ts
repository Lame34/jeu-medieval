/**
 * Painted faction ring under each unit (brief §5.1 pillar "lisibilité tactique"): a soft,
 * brush-edged ring in the allegiance colour, readable at tactical zoom without shouting.
 * Shape is also encoded (attacker: full ring, defender: dashed) for colour-blind players.
 */
import { AdditiveBlending, Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { Faction } from '../../core/rules/types.ts';
import { PALETTE } from '../materials/palette.ts';

const RING_SIZE_M = 2.2;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uDashed;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  float angle = atan(d.y, d.x);
  float wobble = 0.03 * sin(angle * 7.0) + 0.02 * sin(angle * 13.0 + 1.3);
  float ring = smoothstep(0.62 + wobble, 0.72 + wobble, r) * (1.0 - smoothstep(0.84 + wobble, 0.95 + wobble, r));
  float dash = mix(1.0, step(0.5, fract(angle / 6.2831853 * 10.0)), uDashed);
  float brush = 0.75 + 0.25 * hash(floor(vec2(angle * 20.0, r * 8.0)));
  float alpha = ring * dash * brush * 0.85;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const geometry = new PlaneGeometry(RING_SIZE_M, RING_SIZE_M);
geometry.rotateX(-Math.PI / 2);

const materials: Partial<Record<Faction, ShaderMaterial>> = {};

function ringMaterial(faction: Faction): ShaderMaterial {
  const existing = materials[faction];
  if (existing) return existing;
  const color = new Color(faction === 'attacker' ? PALETTE.attacker.primary : PALETTE.defender.primary).multiplyScalar(1.4);
  const material = new ShaderMaterial({
    uniforms: { uColor: { value: color }, uDashed: { value: faction === 'defender' ? 1 : 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
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
