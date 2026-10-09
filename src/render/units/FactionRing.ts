/**
 * Painted faction ring under each unit (brief §5.1 pillar "lisibilité tactique"): a soft,
 * brush-edged ring in the allegiance colour with an ink inner stroke, normal-blended (additive
 * blending turned red to orange on grass). Shape also encodes the side for colour-blind
 * players (attacker: full ring, defender: dashed). Rings grow with camera distance. Drawn
 * instanced, one batch per side (J5 perf: a mesh per unit cost a draw call each); each unit
 * carries an invisible marker the batch follows.
 */
import { Color, DoubleSide, InstancedMesh, NormalBlending, Object3D, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from 'three';
import type { Faction } from '../../core/rules/types.ts';
import { PALETTE } from '../materials/palette.ts';

const RING_SIZE_M = 1.8;
/** Ring scale = clamp(cameraDistance / RING_SCALE_DISTANCE_M, 1, RING_MAX_SCALE). */
export const RING_SCALE_DISTANCE_M = 60;
export const RING_MAX_SCALE = 1.8;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  #ifdef USE_INSTANCING
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  #else
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #endif
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
  // Defender: 6 square dashes (the colour-blind pattern), attacker: full ring.
  float dash = mix(1.0, step(0.42, fract(angle / 6.2831853 * 6.0)), uDashed);
  // Outer ink rim: the ring holds by value, not only by hue, on light or orange ground.
  float rim = smoothstep(0.86 + wobble, 0.9 + wobble, r) * (1.0 - smoothstep(0.93 + wobble, 1.0, r));
  float brush = 0.8 + 0.2 * hash(floor(vec2(angle * 20.0, r * 8.0)));
  float alpha = max(max(ring * dash * brush * 0.95, ink * dash * 0.45), rim * dash * 0.5);
  if (alpha < 0.01) discard;
  vec3 color = mix(uColor, uInk, max(ink * (1.0 - ring), rim));
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

/** Lift of the ring above the unit's feet. */
const RING_LIFT_M = 0.06;

/** The marker a unit carries where its ring is drawn (visible: drawn; scale: the ring's). */
export function createRingMarker(): Object3D {
  const marker = new Object3D();
  marker.name = 'FactionRing:marker';
  marker.position.y = RING_LIFT_M;
  return marker;
}

/** One side's rings, instanced. */
export function createRingBatch(faction: Faction, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, ringMaterial(faction), Math.max(1, capacity));
  mesh.name = `FactionRings:${faction}`;
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/** Draws the visible markers' rings (their world matrices; no allocation). */
export function updateRingBatch(batch: InstancedMesh, markers: readonly Object3D[]): void {
  let n = 0;
  for (const m of markers) {
    if (!m.visible || !m.parent?.visible) continue;
    m.updateWorldMatrix(true, false);
    batch.setMatrixAt(n++, m.matrixWorld);
  }
  batch.count = n;
  batch.instanceMatrix.needsUpdate = true;
}

/** Ground slope sampled this far either side of a unit (m); above the ground (a deck), flat. */
const SLOPE_SAMPLE_M = 0.8;
const ON_DECK_ABOVE_M = 0.3;
const UP = new Vector3(0, 1, 0);
const scratch = { n: new Vector3(), q: new Quaternion(), inv: new Quaternion() };

/** Tilts a unit's ring marker to the ground under it (a flat ring sank into slopes). */
export function alignRingToGround(marker: Object3D, root: Object3D, heightAt: (x: number, z: number) => number): void {
  const { x, z } = root.position;
  const h = heightAt(x, z);
  if (root.position.y - h > ON_DECK_ABOVE_M) {
    marker.quaternion.copy(scratch.inv.copy(root.quaternion).invert());
    return;
  }
  const s = SLOPE_SAMPLE_M;
  scratch.n.set(heightAt(x - s, z) - heightAt(x + s, z), 2 * s, heightAt(x, z - s) - heightAt(x, z + s)).normalize();
  scratch.q.setFromUnitVectors(UP, scratch.n);
  // In the root's frame: undo its yaw, then tilt to the ground normal.
  marker.quaternion.copy(scratch.inv.copy(root.quaternion).invert()).multiply(scratch.q);
}
