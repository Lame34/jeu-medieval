/**
 * Fire on screen (J4, brief §6.4 « feu en flipbook, braises, lueur, fumée »): painted flames as
 * camera-facing quads (a procedural flame drawn in the shader — rising noise, a red to yellow
 * ramp, a soft ragged edge), a glow on the ground under them, columns of dark smoke, and scorch
 * marks on burnt ground. No dynamic light (brief §7: the painted glow is the fallback). Three draw
 * calls at most, none at rest; everything is allocated up front.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  type Material,
} from 'three';
import { hash01 } from '../castle/siege-fx.ts';

const MAX_FLAMES = 600;
const FLAMES_PER_CELL = 3;
const MAX_SCORCH = 3000;
const SMOKE_POOL = 256;
const SMOKE_LIFE_S = 5;
const SMOKE_EVERY_S = 0.35;
/** Smoke rise (m/s) and drift with the wind: (base + per unit of strength) m/s along it. */
const SMOKE_RISE_MS = 2.2;
const SMOKE_DRIFT_MS = 0.8;
const SMOKE_DRIFT_PER_STRENGTH_MS = 1.5;
/** Smoke darkest at birth, paler as it thins (seen from above it read as a cast shadow). */
const SMOKE_YOUNG = '#4b4540';
const SMOKE_OLD = '#a39a8e';
const FLAME_SIZE_M = 1.5;

const FLAME_VERTEX = /* glsl */ `
attribute vec4 aFlame; // seed, size scale, phase, unused
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vTime;
void main() {
  vUv = uv;
  vSeed = aFlame.x;
  vTime = uTime + aFlame.z * 10.0;
  vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  // Billboard: the quad faces the camera around the world's vertical.
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  float size = ${FLAME_SIZE_M.toFixed(2)} * aFlame.y * (0.85 + 0.15 * sin(vTime * 3.1));
  vec3 p = centre.xyz + right * position.x * size + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * size * 1.7;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FLAME_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
varying float vTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 uv = vUv;
  float rise = vTime * 1.6;
  float n = noise(vec2(uv.x * 4.0 + vSeed * 13.0, uv.y * 3.0 - rise)) * 0.65 + noise(vec2(uv.x * 9.0 - vSeed * 7.0, uv.y * 6.0 - rise * 1.7)) * 0.35;
  // A tongue of flame: wide at the foot, licking up to a ragged point.
  float x = (uv.x - 0.5) * 2.0;
  float width = (1.0 - uv.y) * 0.9 + 0.08;
  float body = 1.0 - smoothstep(width * 0.55, width, abs(x) + (n - 0.5) * 0.45);
  float tip = 1.0 - smoothstep(0.55, 1.0, uv.y + (n - 0.5) * 0.5);
  float a = body * tip;
  if (a < 0.03) discard;
  float heat = clamp(a * (1.15 - uv.y) + n * 0.25, 0.0, 1.0);
  // Linear values (ACES follows): an orange body, a yellow heart, no cream-white core.
  vec3 deep = vec3(0.55, 0.10, 0.03);
  vec3 mid = vec3(0.90, 0.32, 0.06);
  vec3 hot = vec3(1.0, 0.70, 0.30);
  vec3 col = mix(deep, mid, smoothstep(0.15, 0.55, heat));
  col = mix(col, hot, smoothstep(0.78, 1.0, heat));
  gl_FragColor = vec4(col, a * 0.92);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vTime;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, r)) * (0.42 + 0.08 * sin(vTime * 5.3));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.5, 0.16) * a, a);
}
`;

const GROUND_VERTEX = /* glsl */ `
attribute vec4 aFlame;
uniform float uTime;
varying vec2 vUv;
varying float vTime;
void main() {
  vUv = uv;
  vTime = uTime + aFlame.z * 10.0;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const SCORCH_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.45, 1.0, r)) * 0.62;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

const SMOKE_VERTEX = /* glsl */ `
attribute vec4 aSmoke; // size, alpha, seed, age
uniform float uPixelsPerMeter;
varying float vAlpha;
varying float vSeed;
varying float vAge;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = aSmoke.x * uPixelsPerMeter / max(1.0, -view.z);
  vAlpha = aSmoke.y;
  vSeed = aSmoke.z;
  vAge = aSmoke.w;
}
`;

const SMOKE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uColorOld;
varying float vAlpha;
varying float vSeed;
varying float vAge;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float rim = 0.8 + 0.1 * sin(ang * 5.0 + vSeed * 29.0) + 0.06 * sin(ang * 11.0 - vSeed * 13.0);
  float a = vAlpha * smoothstep(rim, rim * 0.3, r);
  if (a < 0.01) discard;
  vec3 c = mix(uColor, uColorOld, smoothstep(0.2, 0.7, vAge));
  gl_FragColor = vec4(c * (0.9 + 0.2 * (1.0 - r)), a);
}
`;

/** A cell on fire or burnt, in world space (centre on the ground). */
export interface FireCell {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
}

export class FireField {
  readonly group = new Group();
  private readonly flames: InstancedMesh;
  private readonly glows: InstancedMesh;
  private readonly scorch: InstancedMesh;
  private readonly smoke: Points;
  private readonly materials: ShaderMaterial[];
  private readonly time = { value: 0 };
  private readonly smokePositions = new Float32Array(SMOKE_POOL * 3);
  private readonly smokeParams = new Float32Array(SMOKE_POOL * 4);
  private readonly smokeLife = new Float32Array(SMOKE_POOL).fill(SMOKE_LIFE_S);
  private readonly smokeSizes = new Float32Array(SMOKE_POOL);
  private smokeNext = 0;
  private smokeClock = 0;
  private smokeSerial = 0;
  private readonly drift = { x: SMOKE_DRIFT_MS, z: 0 };
  private burning: readonly FireCell[] = [];
  private readonly m = new Matrix4();

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    const flameSeed = new InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 4), 4);
    quad.setAttribute('aFlame', flameSeed);
    const flameMat = new ShaderMaterial({ name: 'Fire:flame', vertexShader: FLAME_VERTEX, fragmentShader: FLAME_FRAGMENT, uniforms: { uTime: this.time }, transparent: true, depthWrite: false, blending: NormalBlending });
    this.flames = new InstancedMesh(quad, flameMat, MAX_FLAMES);
    this.flames.name = 'Fire:flames';
    this.flames.count = 0;
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 5;
    const ground = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    ground.setAttribute('aFlame', new InstancedBufferAttribute(new Float32Array(MAX_FLAMES * 4), 4));
    const glowMat = new ShaderMaterial({ name: 'Fire:glow', vertexShader: GROUND_VERTEX, fragmentShader: GLOW_FRAGMENT, uniforms: { uTime: this.time }, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.glows = new InstancedMesh(ground, glowMat, MAX_FLAMES);
    this.glows.name = 'Fire:glow';
    this.glows.count = 0;
    this.glows.frustumCulled = false;
    this.glows.renderOrder = 3;
    const scorchGround = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    scorchGround.setAttribute('aFlame', new InstancedBufferAttribute(new Float32Array(MAX_SCORCH * 4), 4));
    const scorchMat = new ShaderMaterial({ name: 'Fire:scorch', vertexShader: GROUND_VERTEX, fragmentShader: SCORCH_FRAGMENT, uniforms: { uTime: this.time, uColor: { value: new Color('#2a2119') } }, transparent: true, depthWrite: false });
    this.scorch = new InstancedMesh(scorchGround, scorchMat, MAX_SCORCH);
    this.scorch.name = 'Fire:scorch';
    this.scorch.count = 0;
    this.scorch.frustumCulled = false;
    this.scorch.renderOrder = 2;
    const smokeGeometry = new BufferGeometry();
    smokeGeometry.setAttribute('position', new BufferAttribute(this.smokePositions, 3).setUsage(DynamicDrawUsage));
    smokeGeometry.setAttribute('aSmoke', new BufferAttribute(this.smokeParams, 4).setUsage(DynamicDrawUsage));
    smokeGeometry.setDrawRange(0, 0);
    const smokeMat = new ShaderMaterial({ name: 'Fire:smoke', vertexShader: SMOKE_VERTEX, fragmentShader: SMOKE_FRAGMENT, uniforms: { uColor: { value: new Color(SMOKE_YOUNG) }, uColorOld: { value: new Color(SMOKE_OLD) }, uPixelsPerMeter: { value: 1 } }, transparent: true, depthWrite: false });
    this.smoke = new Points(smokeGeometry, smokeMat);
    this.smoke.name = 'Fire:smoke';
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 6;
    this.materials = [flameMat, glowMat, scorchMat, smokeMat];
    this.group.add(this.scorch, this.glows, this.flames, this.smoke);
    this.group.name = 'Fire';
  }

  /** The battle's wind (direction x, z and strength 0–1): the smoke drifts with it. */
  setWind(x: number, z: number, strength: number): void {
    const len = Math.hypot(x, z) || 1;
    const speed = SMOKE_DRIFT_MS + SMOKE_DRIFT_PER_STRENGTH_MS * strength;
    this.drift.x = (x / len) * speed;
    this.drift.z = (z / len) * speed;
  }

  /** The cells burning and burnt now. */
  sync(burning: readonly FireCell[], burnt: readonly FireCell[]): void {
    this.burning = burning;
    const seeds = this.flames.geometry.getAttribute('aFlame') as InstancedBufferAttribute;
    const glowSeeds = this.glows.geometry.getAttribute('aFlame') as InstancedBufferAttribute;
    let n = 0;
    burning.forEach((c, k) => {
      for (let f = 0; f < FLAMES_PER_CELL && n < MAX_FLAMES; f++, n++) {
        const s = hash01(c.seed, f, 3);
        this.m.makeTranslation(c.x + (hash01(c.seed, f, 5) - 0.5) * 0.8, c.y, c.z + (hash01(c.seed, f, 7) - 0.5) * 0.8);
        this.flames.setMatrixAt(n, this.m);
        seeds.setXYZW(n, s, 0.75 + 0.5 * hash01(c.seed, f, 9), hash01(c.seed, f, 11), 0);
      }
      if (k < MAX_FLAMES) {
        this.m.makeScale(3.2, 1, 3.2).setPosition(c.x, c.y + 0.06, c.z);
        this.glows.setMatrixAt(k, this.m);
        glowSeeds.setXYZW(k, 0, 0, hash01(c.seed, 1, 13), 0);
      }
    });
    this.flames.count = n;
    this.glows.count = Math.min(burning.length, MAX_FLAMES);
    this.flames.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    seeds.needsUpdate = true;
    glowSeeds.needsUpdate = true;
    const scorched = [...burnt, ...burning];
    let k = 0;
    for (const c of scorched) {
      if (k >= MAX_SCORCH) break;
      this.m.makeScale(1.6 + 0.6 * hash01(c.seed, 2, 17), 1, 1.6 + 0.6 * hash01(c.seed, 3, 19)).setPosition(c.x, c.y + 0.04, c.z);
      this.scorch.setMatrixAt(k++, this.m);
    }
    this.scorch.count = k;
    this.scorch.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, pixelsPerMeter: number): void {
    this.time.value += dt;
    (this.materials[3] as ShaderMaterial & { uniforms: { uPixelsPerMeter: { value: number } } }).uniforms.uPixelsPerMeter.value = pixelsPerMeter;
    // Smoke rises from a few of the fires every so often.
    this.smokeClock += dt;
    if (this.burning.length > 0 && this.smokeClock >= SMOKE_EVERY_S) {
      this.smokeClock = 0;
      const puffs = Math.min(4, Math.ceil(this.burning.length / 6));
      for (let p = 0; p < puffs; p++) {
        const c = this.burning[Math.floor(hash01(this.smokeSerial, p, 21) * this.burning.length)] as FireCell;
        const i = this.smokeNext;
        this.smokeNext = (this.smokeNext + 1) % SMOKE_POOL;
        const s = this.smokeSerial++;
        this.smokePositions.set([c.x + (hash01(s, 1) - 0.5), c.y + 1.6, c.z + (hash01(s, 2) - 0.5)], i * 3);
        this.smokeSizes[i] = 3 + 2.5 * hash01(s, 3);
        this.smokeParams[i * 4 + 2] = hash01(s, 4);
        this.smokeLife[i] = 0;
      }
    }
    let live = 0;
    for (let i = 0; i < SMOKE_POOL; i++) {
      const age = this.smokeLife[i] as number;
      if (age >= SMOKE_LIFE_S) {
        this.smokeParams[i * 4 + 1] = 0;
        continue;
      }
      live++;
      const next = age + dt;
      this.smokeLife[i] = next;
      const k = Math.min(1, next / SMOKE_LIFE_S);
      this.smokePositions[i * 3 + 1] = (this.smokePositions[i * 3 + 1] as number) + dt * SMOKE_RISE_MS * (1 - k * 0.4);
      // Drift picks up as the puff leaves the shelter of the ground.
      this.smokePositions[i * 3] = (this.smokePositions[i * 3] as number) + dt * this.drift.x * (0.4 + 0.6 * k);
      this.smokePositions[i * 3 + 2] = (this.smokePositions[i * 3 + 2] as number) + dt * this.drift.z * (0.4 + 0.6 * k);
      this.smokeParams[i * 4] = (this.smokeSizes[i] as number) * (0.6 + 1.8 * k);
      this.smokeParams[i * 4 + 1] = 0.5 * Math.min(1, k * 6) * (1 - k);
      this.smokeParams[i * 4 + 3] = k;
    }
    const g = this.smoke.geometry;
    g.setDrawRange(0, live > 0 ? SMOKE_POOL : 0);
    (g.getAttribute('position') as BufferAttribute).needsUpdate = live > 0;
    (g.getAttribute('aSmoke') as BufferAttribute).needsUpdate = live > 0;
  }

  dispose(): void {
    for (const mesh of [this.flames, this.glows, this.scorch]) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.smoke.geometry.dispose();
    for (const m of this.materials) (m as Material).dispose();
  }
}
