/**
 * Projectiles in flight (J4, brief §6.4 « flèches avec traînée, trajectoire de catapulte avec
 * ombre au sol, éclaboussures dans les douves »): arrows and bolts on a flat arc with a fading
 * trail (orange for fire arrows), catapult stones on a high arc with their shadow sliding over
 * the ground, and a splash where something falls into water. Pools allocated up front, nothing
 * drawn while nothing flies; the per-frame update only writes matrices and typed arrays.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  NormalBlending,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { finish } from '../castle/castle-geometry.ts';
import { hash01 } from '../castle/siege-fx.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { audio } from '../../audio/engine.ts';
import { setDrawable } from '../drawable.ts';
import { PALETTE } from '../materials/palette.ts';

const MAX_ARROWS = 24;
const MAX_STONES = 6;
const SPLASH_POOL = 160;
const SPLASH_LIFE_S = 1.1;
/** Flight: arrows at this speed (m/s) on an arc this fraction of the distance high; stones slower, higher. */
const ARROW_SPEED_MS = 42;
const ARROW_ARC = 0.05;
const STONE_SPEED_MS = 26;
const STONE_ARC = 0.32;
const STONE_MIN_ARC_M = 9;
const TRAIL_LENGTH_M = 3.4;
/** Projectiles are drawn larger than life: an arrow must read at tactical zoom. */
const ARROW_SCALE = 1.8;
const TRAIL_WIDTH_M = 0.16;
/** Trails (rgb, alpha): a plain arrow's pale streak; a fire arrow's (its hot head is in the shader). */
const PLAIN_TRAIL = [0.85, 0.82, 0.74, 0.55] as const;
const FIRE_TRAIL = [0.95, 0.42, 0.1, 0.8] as const;
/** A catapult stone: a rough flattened boulder (radius, squash) and its ground shadow, tinted not black. */
const STONE_RADIUS_M = 0.55;
const STONE_SQUASH = [1, 0.82, 0.9] as const;
const STONE_COLOR = '#9a8d78';
const SHADOW_SIZE_M = 1.4;
const SHADOW_SIZE_PER_M = 0.05;
const SHADOW_ALPHA = [0.2, 0.5] as const;
const SHADOW_FADE_PER_M = 0.02;

interface Flight {
  active: boolean;
  t: number;
  duration: number;
  arc: number;
  readonly from: Vector3;
  readonly to: Vector3;
  fire: boolean;
  onLand: (() => void) | null;
}

const TRAIL_VERTEX = /* glsl */ `
attribute vec4 aTrail; // r, g, b, alpha
varying vec2 vUv;
varying vec4 vTrail;
void main() {
  vUv = uv;
  vTrail = aTrail;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const TRAIL_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec4 vTrail;
void main() {
  // Tapering towards the tail; a fire trail (negative alpha) has a hot head over its front 12 %.
  float w = 1.0 - 0.6 * vUv.y;
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0 / w;
  if (across <= 0.0) discard;
  float along = 1.0 - vUv.y;
  float fire = step(vTrail.a, 0.0);
  float a = abs(vTrail.a) * along * along * across;
  if (a < 0.01) discard;
  vec3 col = mix(vTrail.rgb, vec3(1.0, 0.78, 0.35), fire * smoothstep(0.84, 0.92, along));
  gl_FragColor = vec4(col, a);
}
`;
const SHADOW_VERTEX = /* glsl */ `
attribute float aShade;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  vShade = aShade;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const SHADOW_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vShade;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.3, 1.0, r)) * vShade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.20, 0.22, 0.36), a);
}
`;
const SPLASH_VERTEX = /* glsl */ `
attribute vec2 aSplash; // size, alpha
uniform float uPixelsPerMeter;
varying float vAlpha;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = aSplash.x * uPixelsPerMeter / max(1.0, -view.z);
  vAlpha = aSplash.y;
}
`;
const SPLASH_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float a = vAlpha * (1.0 - smoothstep(0.5, 1.0, r));
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.86, 0.92, 0.95, a);
}
`;

function arrowGeometry(): BufferGeometry {
  const wood = new Color(PALETTE.woodLight.lit);
  const iron = new Color('#3e3f44');
  const feather = new Color('#e9e2d0');
  const shaft = new CylinderGeometry(0.018, 0.018, 0.85, 5, 1, false).rotateX(Math.PI / 2).translate(0, 0, -0.1);
  const head = new ConeGeometry(0.04, 0.12, 5, 1, false).rotateX(Math.PI / 2).translate(0, 0, 0.38);
  const vane = new PlaneGeometry(0.07, 0.16).rotateY(Math.PI / 2).translate(0, 0.035, -0.45);
  const vane2 = new PlaneGeometry(0.07, 0.16).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).translate(0.035, 0, -0.45);
  const parts = [finish(shaft.toNonIndexed(), -1, wood), finish(head.toNonIndexed(), -1, iron), finish(vane.toNonIndexed(), -1, feather), finish(vane2.toNonIndexed(), -1, feather)];
  [shaft, head, vane, vane2].forEach((g) => g.dispose());
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error('arrow merge failed');
  return merged;
}

export interface ProjectileOptions {
  /** True when the point lies on water (moat, river): a falling projectile splashes. */
  readonly waterAt: (x: number, z: number) => boolean;
  /** Ground height under a point (the stone's shadow slides on it). */
  readonly groundAt: (x: number, z: number) => number;
}

export class ProjectilePool {
  readonly group = new Group();
  private readonly arrows: InstancedMesh;
  private readonly trails: InstancedMesh;
  private readonly stones: InstancedMesh;
  private readonly shadows: InstancedMesh;
  private readonly splash: Points;
  private readonly materials: Material[];
  private readonly arrowFlights: Flight[];
  private readonly stoneFlights: Flight[];
  private readonly options: ProjectileOptions;
  private readonly splashPositions = new Float32Array(SPLASH_POOL * 3);
  private readonly splashVelocity = new Float32Array(SPLASH_POOL * 3);
  private readonly splashParams = new Float32Array(SPLASH_POOL * 2);
  private readonly splashLife = new Float32Array(SPLASH_POOL).fill(SPLASH_LIFE_S);
  private splashNext = 0;
  private splashSerial = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly prev = new Vector3();
  private readonly dir = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly arrowScale = new Vector3(ARROW_SCALE, ARROW_SCALE, ARROW_SCALE);

  constructor(options: ProjectileOptions) {
    this.options = options;
    const painted = createPaintedMaterial({ name: 'Projectile', vertexColors: true, vertexData: true, heightM: 1 });
    this.arrows = new InstancedMesh(arrowGeometry(), painted, MAX_ARROWS);
    // Two crossed ribbons behind the arrow (seen from any side); v runs 0 at the arrow → 1 at the tail.
    const ribbon = () => new PlaneGeometry(TRAIL_WIDTH_M, TRAIL_LENGTH_M).rotateX(-Math.PI / 2).translate(0, 0, -TRAIL_LENGTH_M / 2 - 0.4);
    const trailQuad = mergeGeometries([ribbon(), ribbon().rotateZ(Math.PI / 2)], false);
    if (!trailQuad) throw new Error('trail merge failed');
    trailQuad.setAttribute('aTrail', new InstancedBufferAttribute(new Float32Array(MAX_ARROWS * 4), 4));
    const trailMat = new ShaderMaterial({ name: 'Projectile:trail', vertexShader: TRAIL_VERTEX, fragmentShader: TRAIL_FRAGMENT, transparent: true, depthWrite: false, blending: NormalBlending });
    this.trails = new InstancedMesh(trailQuad, trailMat, MAX_ARROWS);
    const stoneGeometry = finish(new IcosahedronGeometry(STONE_RADIUS_M, 0).scale(...STONE_SQUASH), -1, new Color(STONE_COLOR));
    this.stones = new InstancedMesh(stoneGeometry, painted, MAX_STONES);
    const disc = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    disc.setAttribute('aShade', new InstancedBufferAttribute(new Float32Array(MAX_STONES), 1));
    const shadowMat = new ShaderMaterial({ name: 'Projectile:shadow', vertexShader: SHADOW_VERTEX, fragmentShader: SHADOW_FRAGMENT, transparent: true, depthWrite: false });
    this.shadows = new InstancedMesh(disc, shadowMat, MAX_STONES);
    const splashGeometry = new BufferGeometry();
    splashGeometry.setAttribute('position', new BufferAttribute(this.splashPositions, 3).setUsage(DynamicDrawUsage));
    splashGeometry.setAttribute('aSplash', new BufferAttribute(this.splashParams, 2).setUsage(DynamicDrawUsage));
    splashGeometry.setDrawRange(0, 0);
    const splashMat = new ShaderMaterial({ name: 'Projectile:splash', vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT, uniforms: { uPixelsPerMeter: { value: 1 } }, transparent: true, depthWrite: false });
    this.splash = new Points(splashGeometry, splashMat);
    for (const [mesh, name, order] of [
      [this.arrows, 'Projectile:arrows', 0],
      [this.trails, 'Projectile:trails', 5],
      [this.stones, 'Projectile:stones', 0],
      [this.shadows, 'Projectile:shadows', 2],
    ] as const) {
      mesh.name = name;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      setDrawable(mesh, false);
    }
    setDrawable(this.splash, false);
    this.arrows.castShadow = true;
    this.stones.castShadow = true;
    this.splash.name = 'Projectile:splash';
    this.splash.frustumCulled = false;
    this.splash.renderOrder = 6;
    this.materials = [painted, trailMat, shadowMat, splashMat];
    this.group.name = 'Projectiles';
    this.group.add(this.shadows, this.arrows, this.trails, this.stones, this.splash);
    const flight = (): Flight => ({ active: false, t: 0, duration: 1, arc: 0, from: new Vector3(), to: new Vector3(), fire: false, onLand: null });
    this.arrowFlights = Array.from({ length: MAX_ARROWS }, flight);
    this.stoneFlights = Array.from({ length: MAX_STONES }, flight);
  }

  /** Shoots an arrow (a fire arrow trails orange); returns its flight time (s). */
  arrow(from: Vector3, to: Vector3, fire: boolean, onLand: (() => void) | null): number {
    const d = from.distanceTo(to);
    return this.launch(this.arrowFlights, from, to, d / ARROW_SPEED_MS, Math.max(0.3, d * ARROW_ARC), fire, onLand);
  }

  /** Lobs a catapult stone; returns its flight time (s). */
  stone(from: Vector3, to: Vector3, onLand: (() => void) | null): number {
    const d = from.distanceTo(to);
    return this.launch(this.stoneFlights, from, to, Math.max(1.2, d / STONE_SPEED_MS), Math.max(STONE_MIN_ARC_M, d * STONE_ARC), false, onLand);
  }

  private launch(pool: Flight[], from: Vector3, to: Vector3, duration: number, arc: number, fire: boolean, onLand: (() => void) | null): number {
    const f = pool.find((x) => !x.active) ?? pool[0];
    if (!f) return 0;
    f.active = true;
    f.t = 0;
    f.duration = duration;
    f.arc = arc;
    f.from.copy(from);
    f.to.copy(to);
    f.fire = fire;
    f.onLand = onLand;
    return duration;
  }

  private at(f: Flight, s: number, out: Vector3): Vector3 {
    return out.lerpVectors(f.from, f.to, s).setY(f.from.y + (f.to.y - f.from.y) * s + 4 * f.arc * s * (1 - s));
  }

  update(dt: number, pixelsPerMeter: number): void {
    // Arrows and their trails.
    let n = 0;
    const trailAttr = this.trails.geometry.getAttribute('aTrail') as InstancedBufferAttribute;
    for (const f of this.arrowFlights) {
      if (!f.active) continue;
      if (this.advance(f, dt)) continue;
      const s = f.t / f.duration;
      this.at(f, s, this.p);
      this.at(f, Math.max(0, s - 0.02), this.prev);
      this.dir.subVectors(this.p, this.prev).normalize();
      this.q.setFromUnitVectors(FORWARD, this.dir);
      this.m.compose(this.p, this.q, this.arrowScale);
      this.arrows.setMatrixAt(n, this.m);
      this.m.compose(this.p, this.q, this.s);
      this.trails.setMatrixAt(n, this.m);
      if (f.fire) trailAttr.setXYZW(n, FIRE_TRAIL[0], FIRE_TRAIL[1], FIRE_TRAIL[2], -FIRE_TRAIL[3]);
      else trailAttr.setXYZW(n, PLAIN_TRAIL[0], PLAIN_TRAIL[1], PLAIN_TRAIL[2], PLAIN_TRAIL[3]);
      n++;
    }
    this.arrows.count = n;
    this.trails.count = n;
    setDrawable(this.arrows, n > 0);
    setDrawable(this.trails, n > 0);
    if (n > 0) {
      this.arrows.instanceMatrix.needsUpdate = true;
      this.trails.instanceMatrix.needsUpdate = true;
      trailAttr.needsUpdate = true;
    }
    // Stones and their shadows on the ground.
    let k = 0;
    const shade = this.shadows.geometry.getAttribute('aShade') as InstancedBufferAttribute;
    for (const f of this.stoneFlights) {
      if (!f.active) continue;
      if (this.advance(f, dt)) continue;
      const s = f.t / f.duration;
      this.at(f, s, this.p);
      this.q.setFromAxisAngle(SPIN_AXIS, f.t * 5);
      this.m.compose(this.p, this.q, this.s);
      this.stones.setMatrixAt(k, this.m);
      const ground = this.options.groundAt(this.p.x, this.p.z);
      const height = Math.max(0, this.p.y - ground);
      const size = SHADOW_SIZE_M + height * SHADOW_SIZE_PER_M;
      this.m.makeScale(size, 1, size).setPosition(this.p.x, ground + 0.08, this.p.z);
      this.shadows.setMatrixAt(k, this.m);
      shade.setX(k, Math.max(SHADOW_ALPHA[0], SHADOW_ALPHA[1] - height * SHADOW_FADE_PER_M));
      k++;
    }
    this.stones.count = k;
    this.shadows.count = k;
    setDrawable(this.stones, k > 0);
    setDrawable(this.shadows, k > 0);
    if (k > 0) {
      this.stones.instanceMatrix.needsUpdate = true;
      this.shadows.instanceMatrix.needsUpdate = true;
      shade.needsUpdate = true;
    }
    this.updateSplash(dt, pixelsPerMeter);
  }

  /** Moves a flight on; lands it (callback, splash) and frees it when done. True when it landed. */
  private advance(f: Flight, dt: number): boolean {
    f.t += dt;
    if (f.t < f.duration) return false;
    f.active = false;
    if (this.options.waterAt(f.to.x, f.to.z)) {
      this.splashAt(f.to, f.arc > STONE_MIN_ARC_M - 1 ? 26 : 8);
      audio.play('splash', { at: f.to, volume: f.arc > STONE_MIN_ARC_M - 1 ? 1 : 0.4 });
    }
    const land = f.onLand;
    f.onLand = null;
    land?.();
    return true;
  }

  private splashAt(at: Vector3, count: number): void {
    for (let c = 0; c < count; c++) {
      const i = this.splashNext;
      this.splashNext = (this.splashNext + 1) % SPLASH_POOL;
      const s = this.splashSerial++;
      const a = hash01(s, 1) * Math.PI * 2;
      const r = 0.6 + 1.6 * hash01(s, 2);
      this.splashPositions.set([at.x, at.y + 0.1, at.z], i * 3);
      this.splashVelocity.set([Math.cos(a) * r, 2.5 + 3 * hash01(s, 3), Math.sin(a) * r], i * 3);
      this.splashParams[i * 2] = 0.25 + 0.35 * hash01(s, 4);
      this.splashLife[i] = 0;
    }
  }

  private updateSplash(dt: number, pixelsPerMeter: number): void {
    (this.materials[3] as ShaderMaterial & { uniforms: { uPixelsPerMeter: { value: number } } }).uniforms.uPixelsPerMeter.value = pixelsPerMeter;
    let live = 0;
    for (let i = 0; i < SPLASH_POOL; i++) {
      const age = this.splashLife[i] as number;
      if (age >= SPLASH_LIFE_S) {
        this.splashParams[i * 2 + 1] = 0;
        continue;
      }
      live++;
      this.splashLife[i] = age + dt;
      this.splashVelocity[i * 3 + 1] = (this.splashVelocity[i * 3 + 1] as number) - 9.8 * dt;
      for (let c = 0; c < 3; c++) this.splashPositions[i * 3 + c] = (this.splashPositions[i * 3 + c] as number) + (this.splashVelocity[i * 3 + c] as number) * dt;
      this.splashParams[i * 2 + 1] = 0.85 * (1 - age / SPLASH_LIFE_S);
    }
    const g = this.splash.geometry;
    g.setDrawRange(0, live > 0 ? SPLASH_POOL : 0);
    setDrawable(this.splash, live > 0);
    if (live > 0) {
      (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (g.getAttribute('aSplash') as BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of [this.arrows, this.trails, this.stones, this.shadows]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.splash.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}

const FORWARD = new Vector3(0, 0, 1);
const SPIN_AXIS = new Vector3(0.6, 0.8, 0).normalize();
