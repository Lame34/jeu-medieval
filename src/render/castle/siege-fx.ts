/**
 * Siege effects on the castle (J4, brief §9.8 and §6.4): cracks spreading over a damaged curtain,
 * the pre-fractured blocks of a collapsing segment falling into a low heap of rubble, and a
 * pool of painted dust puffs. Everything is deterministic (hashed from the segment) and allocated
 * up front: the per-frame updates only write into typed arrays.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Material,
} from 'three';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { WallRun } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';
import { boxGeometry, finish } from './castle-geometry.ts';


/** Deterministic [0, 1) from integers (no Math.random in the scene either: replays look the same). */
export function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** One segment of a wall run, with its frame (outward = the side the merlons face). */
export interface SegmentFrame {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly length: number;
  readonly dir: Vec2;
  readonly outward: Vec2;
  readonly base: number;
  readonly height: number;
  readonly thickness: number;
}

export function segmentFrame(wall: WallRun, k: number): SegmentFrame {
  const a = wall.points[k] as Vec2;
  const b = wall.points[k + 1] as Vec2;
  const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const dir = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
  // castle-geometry: yaw = atan2(-dz, dx), dir3 = (cos, -sin) = dir, outward = (dir.z, -dir.x).
  return { a, b, length, dir, outward: { x: dir.z, z: -dir.x }, base: wall.baseHeightM, height: wall.heightM, thickness: wall.thicknessM };
}

// --- Cracks ---------------------------------------------------------------------------------

const CRACKS_AT_FULL_DAMAGE = 9;
const CRACK_STEPS = 7;
const CRACK_STEP_M = 0.75;
const CRACK_WIDTH_M = 0.34;
const CRACK_OFFSET_M = 0.04;
const CRACK_COLOR = '#5e5043';

/** Dark branching cracks on the outer face of a segment; more of them as `damage` (0–1) grows. */
export function crackGeometry(f: SegmentFrame, seed: number, damage: number): BufferGeometry | null {
  const count = Math.round(Math.min(1, damage) * CRACKS_AT_FULL_DAMAGE);
  if (count === 0) return null;
  const positions: number[] = [];
  const face = f.thickness / 2 + CRACK_OFFSET_M;
  const point = (u: number, y: number) => [f.a.x + f.dir.x * u + f.outward.x * face, y, f.a.z + f.dir.z * u + f.outward.z * face];
  const strip = (u0: number, y0: number, u1: number, y1: number, w: number) => {
    // A quad across the stroke, in the face plane.
    const du = u1 - u0;
    const dy = y1 - y0;
    const len = Math.hypot(du, dy) || 1;
    const nu = (-dy / len) * (w / 2);
    const ny = (du / len) * (w / 2);
    const p0 = point(u0 - nu, y0 - ny);
    const p1 = point(u0 + nu, y0 + ny);
    const p2 = point(u1 + nu * 0.6, y1 + ny * 0.6);
    const p3 = point(u1 - nu * 0.6, y1 - ny * 0.6);
    // Both windings: the strip shows from either side with the castle's single-sided timber material.
    positions.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3, ...p0, ...p2, ...p1, ...p0, ...p3, ...p2);
  };
  for (let c = 0; c < count; c++) {
    let u = f.length * (0.12 + 0.76 * hash01(seed, c, 1));
    let y = f.base + f.height * (0.45 + 0.5 * hash01(seed, c, 2));
    let w = CRACK_WIDTH_M * (0.8 + 0.6 * hash01(seed, c, 3));
    for (let s = 0; s < CRACK_STEPS; s++) {
      const angle = -Math.PI / 2 + (hash01(seed, c * 31 + s, 4) - 0.5) * 2.2;
      const step = CRACK_STEP_M * (0.6 + 0.8 * hash01(seed, c * 31 + s, 5));
      const u1 = Math.min(f.length - 0.3, Math.max(0.3, u + Math.cos(angle) * step));
      const y1 = Math.max(f.base + 0.8, y + Math.sin(angle) * step);
      strip(u, y, u1, y1, w);
      if (hash01(seed, c * 31 + s, 6) < 0.25) strip(u1, y1, u1 + (hash01(seed, c, s + 7) - 0.5) * 1.6, y1 - 0.5 * step, w * 0.55);
      u = u1;
      y = y1;
      w *= 0.8;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  return finish(g, f.base, new Color(CRACK_COLOR));
}


// --- Collapse -------------------------------------------------------------------------------

const BLOCK_ALONG_M = 1.35;
const BLOCK_ROW_M = 1.25;
/** Rubble stays this low over the breach itself (units cross it), heaps up beside it. */
const HEAP_OVER_BREACH_M = 0.7;
const HEAP_CELL_M = 1.1;
const SPREAD_M = 6.5;
const GRAVITY = 9.8;
/** Moss and streak treatment of the stone material counts heights from here (blocks are rubble). */
const BLOCK_PAINT_HEIGHT_M = 6;

export interface FallingBlock {
  readonly from: Vector3;
  readonly to: Vector3;
  readonly size: Vector3;
  readonly yaw: number;
  readonly rest: Quaternion;
  readonly delay: number;
  readonly fall: number;
}

/**
 * Blocks a segment breaks into (two leaves of masonry, rows up its height) and where each comes
 * to rest: thrown either side of the wall line, stacked on a coarse heap that stays low over
 * the breach. `ground` gives the relief height.
 */
export function planCollapse(f: SegmentFrame, seed: number, ground: (x: number, z: number) => number): FallingBlock[] {
  const blocks: FallingBlock[] = [];
  const along = Math.max(1, Math.floor(f.length / BLOCK_ALONG_M));
  const rows = Math.max(1, Math.floor(f.height / BLOCK_ROW_M));
  const heap = new Map<string, number>();
  const yaw = Math.atan2(-f.dir.z, f.dir.x);
  let n = 0;
  for (let i = 0; i < along; i++) {
    for (let r = 0; r < rows; r++) {
      for (let leaf = 0; leaf < 2; leaf++, n++) {
        const u = ((i + 0.5) / along) * f.length;
        const across = (leaf === 0 ? 1 : -1) * (f.thickness / 4);
        // Broken stone, not bricks: sizes vary a lot, some blocks are mere fragments.
        const shrink = hash01(seed, n, 10) < 0.35 ? 0.45 + 0.25 * hash01(seed, n, 11) : 1;
        const size = new Vector3((f.length / along) * (0.6 + 0.38 * hash01(seed, n, 1)) * shrink, (f.height / rows) * (0.55 + 0.4 * hash01(seed, n, 2)) * shrink, (f.thickness / 2) * (0.6 + 0.35 * hash01(seed, n, 3)) * shrink);
        const from = new Vector3(f.a.x + f.dir.x * u + f.outward.x * across, f.base + ((r + 0.5) / rows) * f.height, f.a.z + f.dir.z * u + f.outward.z * across);
        // Outer leaf falls outwards, inner leaf inwards; higher blocks fly farther.
        const side = leaf === 0 ? 1 : -1;
        const throwM = (0.6 + (r / rows) * SPREAD_M) * (0.5 + 0.7 * hash01(seed, n, 4));
        let off = side * (f.thickness / 2 + throwM * 0.6);
        const du = (hash01(seed, n, 5) - 0.5) * 1.6;
        const cellOf = (o: number) => `${Math.floor((u + du) / HEAP_CELL_M)},${Math.floor(o / HEAP_CELL_M)}`;
        // Over the breach the heap stays low: push the block outwards until it fits.
        while (Math.abs(off) < f.thickness / 2 + 0.6 && (heap.get(cellOf(off)) ?? 0) + size.y * 0.5 > HEAP_OVER_BREACH_M) off += side * HEAP_CELL_M;
        const key = cellOf(off);
        const stack = heap.get(key) ?? 0;
        heap.set(key, stack + size.y * 0.45);
        const x = f.a.x + f.dir.x * (u + du) + f.outward.x * off;
        const z = f.a.z + f.dir.z * (u + du) + f.outward.z * off;
        const to = new Vector3(x, ground(x, z) + stack + size.y * 0.32, z);
        const rest = new Quaternion().setFromEuler(new Euler((hash01(seed, n, 6) - 0.5) * 1.1, (hash01(seed, n, 7) - 0.5) * 1.4, (hash01(seed, n, 8) - 0.5) * 1.1));
        // The middle of the segment goes first, the collapse runs out to its ends.
        const delay = (Math.abs(u / f.length - 0.5) * 0.9 + hash01(seed, n, 9) * 0.25) * (1 - 0.35 * (r / rows));
        const fall = Math.sqrt((2 * Math.max(0.5, from.y - to.y)) / GRAVITY) * 1.15;
        blocks.push({ from, to, size, yaw, rest, delay, fall });
      }
    }
  }
  return blocks;
}

/** Instanced rubble for one collapse, animated by `pose(t)`; `material` is the castle's stone. */
export class Rubble {
  readonly mesh: InstancedMesh;
  readonly duration: number;
  private readonly blocks: readonly FallingBlock[];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q0 = new Quaternion();
  private readonly q1 = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(blocks: readonly FallingBlock[], material: Material, name: string) {
    const unit = finish(boxGeometry({ center: new Vector3(0, 0, 0), size: new Vector3(1, 1, 1), yaw: 0 }), -BLOCK_PAINT_HEIGHT_M, new Color('#ffffff'));
    this.mesh = new InstancedMesh(unit, material, blocks.length);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.blocks = blocks;
    this.duration = blocks.reduce((m, b) => Math.max(m, b.delay + b.fall), 0);
  }

  /** Places every block at time `t` (s) of the collapse (0: still standing, ≥ duration: at rest). */
  pose(t: number): void {
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i] as FallingBlock;
      const k = Math.min(1, Math.max(0, (t - b.delay) / b.fall));
      const e = k * k;
      this.p.set(b.from.x + (b.to.x - b.from.x) * (1 - (1 - k) * (1 - k)), b.from.y + (b.to.y - b.from.y) * e, b.from.z + (b.to.z - b.from.z) * (1 - (1 - k) * (1 - k)));
      this.q0.setFromAxisAngle(UP, b.yaw);
      this.q1.set(0, 0, 0, 1).slerp(b.rest, k);
      this.q.copy(this.q0).multiply(this.q1);
      this.s.copy(b.size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

const UP = new Vector3(0, 1, 0);

// --- Dust ------------------------------------------------------------------------------------

const DUST_POOL = 192;
const DUST_LIFE_S = 3.2;
const DUST_RISE_MS = 0.6;

const DUST_VERTEX = /* glsl */ `
attribute vec4 aDust; // size (m), alpha, seed, age 0..1
varying float vAlpha;
varying float vSeed;
uniform float uPixelsPerMeter;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = aDust.x * uPixelsPerMeter / max(1.0, -view.z);
  vAlpha = aDust.y;
  vSeed = aDust.z;
}
`;

const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  // A soft painted blob with a ragged rim (no hard sprite edge).
  float a = atan(p.y, p.x);
  float rim = 0.78 + 0.12 * sin(a * 5.0 + vSeed * 31.0) + 0.06 * sin(a * 9.0 - vSeed * 17.0);
  float alpha = vAlpha * smoothstep(rim, rim * 0.35, r);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor * (0.92 + 0.16 * (1.0 - r)), alpha);
}
`;

/** A pool of dust puffs (one draw call): \`emit\` at an impact or along a collapse, \`update\` each frame. */
export class DustPool {
  readonly points: Points;
  private readonly positions: Float32Array;
  private readonly params: Float32Array;
  private readonly velocity: Float32Array;
  private readonly life: Float32Array;
  private readonly sizes: Float32Array;
  private next = 0;
  private live = 0;
  private serial = 0;

  constructor(pixelsPerMeter: number) {
    this.positions = new Float32Array(DUST_POOL * 3);
    this.params = new Float32Array(DUST_POOL * 4);
    this.velocity = new Float32Array(DUST_POOL * 3);
    this.life = new Float32Array(DUST_POOL).fill(DUST_LIFE_S);
    this.sizes = new Float32Array(DUST_POOL);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aDust', new BufferAttribute(this.params, 4).setUsage(DynamicDrawUsage));
    const material = new ShaderMaterial({
      name: 'Castle:dust',
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: { uColor: { value: new Color(PALETTE.stone.lit).multiplyScalar(1.05) }, uPixelsPerMeter: { value: pixelsPerMeter } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(g, material);
    this.points.name = 'Castle:dust';
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    // Nothing to draw until the first puff (no draw call; the program is still compiled up front).
    g.setDrawRange(0, 0);
  }

  setPixelsPerMeter(v: number): void {
    ((this.points.material as ShaderMaterial).uniforms['uPixelsPerMeter'] as { value: number }).value = v;
  }

  /** `count` puffs around (x, y, z) within `radius` (m), `sizeM` across, drifting up and out. */
  emit(x: number, y: number, z: number, count: number, radius: number, sizeM: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % DUST_POOL;
      const s = this.serial++;
      const a = hash01(s, 1) * Math.PI * 2;
      const r = radius * Math.sqrt(hash01(s, 2));
      this.positions[i * 3] = x + Math.cos(a) * r;
      this.positions[i * 3 + 1] = y + hash01(s, 3) * radius * 0.4;
      this.positions[i * 3 + 2] = z + Math.sin(a) * r;
      this.velocity[i * 3] = Math.cos(a) * (0.4 + hash01(s, 4) * 0.8);
      this.velocity[i * 3 + 1] = DUST_RISE_MS * (0.5 + hash01(s, 5));
      this.velocity[i * 3 + 2] = Math.sin(a) * (0.4 + hash01(s, 4) * 0.8);
      this.sizes[i] = sizeM * (0.7 + 0.6 * hash01(s, 6));
      this.params[i * 4 + 2] = hash01(s, 7);
      if ((this.life[i] as number) >= DUST_LIFE_S) this.live++;
      this.points.geometry.setDrawRange(0, DUST_POOL);
      this.life[i] = 0;
    }
  }

  update(dt: number): void {
    if (this.live === 0) return;
    for (let i = 0; i < DUST_POOL; i++) {
      const age = this.life[i] as number;
      if (age >= DUST_LIFE_S) continue;
      const next = age + dt;
      this.life[i] = next;
      if (next >= DUST_LIFE_S) {
        this.params[i * 4 + 1] = 0;
        this.live--;
        if (this.live === 0) this.points.geometry.setDrawRange(0, 0);
        continue;
      }
      const k = next / DUST_LIFE_S;
      const drag = Math.exp(-1.2 * dt);
      for (let c = 0; c < 3; c++) {
        this.velocity[i * 3 + c] = (this.velocity[i * 3 + c] as number) * drag;
        this.positions[i * 3 + c] = (this.positions[i * 3 + c] as number) + (this.velocity[i * 3 + c] as number) * dt;
      }
      // Billows out, then thins away.
      this.params[i * 4] = (this.sizes[i] as number) * (0.6 + 1.4 * Math.sqrt(k));
      this.params[i * 4 + 1] = 0.55 * Math.min(1, k * 8) * (1 - k) * (1 - k);
      this.params[i * 4 + 3] = k;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('aDust') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as Material).dispose();
  }
}
