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
  InstancedBufferAttribute,
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
import { finish } from './castle-geometry.ts';
import { setDrawable } from '../drawable.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';


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
const CRACK_WIDTH_M = 0.5;
const CRACK_TAPER = 0.88;
const CRACK_OFFSET_M = 0.04;
const CRACK_COLOR = '#2b2326';
/** The lit upper lip of each crack (the face breaks, the light catches its edge). */
const CRACK_LIP_COLOR = '#c2b59c';
const CRACK_LIP_RISE_M = 0.06;
const CRACK_LIP_WIDTH = 0.35;
/** Past this damage stones are missing from the face; past the second, chips lie at the foot. */
const MISSING_STONES_AT = 0.5;
const MISSING_STONES = [3, 6] as const;
const MISSING_STONE_M = { w: 0.6, h: 0.35 } as const;
const CHIPS_AT = 0.7;
const CHIPS = [6, 10] as const;
const CHIP_COLOR = '#8e8272';

/**
 * Dark branching cracks on the outer face of a segment, each with a lit upper lip; more of them
 * as `damage` (0–1) grows; past half damage stones are missing from the face, past
 * CHIPS_AT broken chips lie at its foot. `ground` gives the relief height.
 */
export function crackGeometry(f: SegmentFrame, seed: number, damage: number, ground: (x: number, z: number) => number): BufferGeometry | null {
  const count = Math.round(Math.min(1, damage) * CRACKS_AT_FULL_DAMAGE);
  if (count === 0) return null;
  const dark: number[] = [];
  const lip: number[] = [];
  const chips: number[] = [];
  let positions = dark;
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
      positions = dark;
      strip(u, y, u1, y1, w);
      positions = lip;
      strip(u, y + w * 0.5 + CRACK_LIP_RISE_M, u1, y1 + w * 0.5 + CRACK_LIP_RISE_M, w * CRACK_LIP_WIDTH);
      positions = dark;
      if (hash01(seed, c * 31 + s, 6) < 0.25) strip(u1, y1, u1 + (hash01(seed, c, s + 7) - 0.5) * 1.6, y1 - 0.5 * step, w * 0.55);
      u = u1;
      y = y1;
      w *= CRACK_TAPER;
    }
  }
  // Missing stones: dark sockets in the face.
  if (damage >= MISSING_STONES_AT) {
    positions = dark;
    const n = MISSING_STONES[0] + Math.round(((damage - MISSING_STONES_AT) / (1 - MISSING_STONES_AT)) * (MISSING_STONES[1] - MISSING_STONES[0]));
    for (let i = 0; i < n; i++) {
      const u = f.length * (0.1 + 0.8 * hash01(seed, i, 40));
      const y = f.base + f.height * (0.25 + 0.65 * hash01(seed, i, 41));
      strip(u - MISSING_STONE_M.w / 2, y, u + MISSING_STONE_M.w / 2, y, MISSING_STONE_M.h);
    }
  }
  // Chips fallen at the foot: small wedges on the ground, outside.
  if (damage >= CHIPS_AT) {
    const n = CHIPS[0] + Math.round(((damage - CHIPS_AT) / (1 - CHIPS_AT)) * (CHIPS[1] - CHIPS[0]));
    for (let i = 0; i < n; i++) {
      const u = f.length * (0.08 + 0.84 * hash01(seed, i, 50));
      const out = f.thickness / 2 + 0.4 + 1.6 * hash01(seed, i, 51);
      const x = f.a.x + f.dir.x * u + f.outward.x * out;
      const z = f.a.z + f.dir.z * u + f.outward.z * out;
      const s = 0.25 + 0.3 * hash01(seed, i, 52);
      const yaw = hash01(seed, i, 53) * Math.PI * 2;
      const y = ground(x, z);
      // A low tetrahedron: three base corners and a raised tip.
      const corner = (k: number) => [x + Math.cos(yaw + (k * Math.PI * 2) / 3) * s, y, z + Math.sin(yaw + (k * Math.PI * 2) / 3) * s];
      const tip = [x + 0.1 * s, y + s * 0.8, z - 0.1 * s];
      const [c0, c1, c2] = [corner(0), corner(1), corner(2)];
      chips.push(...c0, ...c1, ...tip, ...c1, ...c2, ...tip, ...c2, ...c0, ...tip);
    }
  }
  const part = (data: number[], color: string) => {
    if (data.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(data), 3));
    g.computeVertexNormals();
    return finish(g, f.base, new Color(color));
  };
  const parts = [part(dark, CRACK_COLOR), part(lip, CRACK_LIP_COLOR), part(chips, CHIP_COLOR)].filter((g): g is BufferGeometry => g !== null);
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}


// --- Collapse -------------------------------------------------------------------------------

const BLOCK_ALONG_M = 0.9;
const BLOCK_ROW_M = 0.85;
/** Share of blocks that are mere fragments, and their size factor. */
const FRAGMENT_SHARE = 0.5;
const FRAGMENT_SIZE = [0.3, 0.55] as const;
/** Each block's tone (instance colour), so the heap is not one flat grey. */
const BLOCK_TONE = [0.82, 1.08] as const;
/** The broken stone's corners: chamfer (fraction of the half size) and jitter. */
const CHUNK_CHAMFER = 0.32;
const CHUNK_JITTER = 0.18;
/** The bed of crushed stone under a breach: a ragged patch (length + extra) × depth. */
const BED_EXTRA_M = 3;
const BED_DEPTH_M = 7;
const BED_SIDES = 16;
const BED_RAGGED = 0.25;
const BED_LIFT_M = 0.06;
const BED_COLOR = '#8e8272';
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
        const shrink = hash01(seed, n, 10) < FRAGMENT_SHARE ? FRAGMENT_SIZE[0] + (FRAGMENT_SIZE[1] - FRAGMENT_SIZE[0]) * hash01(seed, n, 11) : 1;
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

/**
 * A broken stone: a box with chamfered corners (octagonal faces, a facet at each corner), the
 * corners pushed in or out so no two faces are parallel; about 44 triangles.
 */
export function chunkGeometry(seed: number): BufferGeometry {
  const h = 0.5;
  const c = h * CHUNK_CHAMFER;
  const corners: { s: [number, number, number]; v: [number, number, number][] }[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const j = 1 + (hash01(seed, corners.length, 60) - 0.5) * 2 * CHUNK_JITTER;
        const v: [number, number, number][] = [
          [sx * (h - c) * j, sy * h * j, sz * h * j],
          [sx * h * j, sy * (h - c) * j, sz * h * j],
          [sx * h * j, sy * h * j, sz * (h - c) * j],
        ];
        corners.push({ s: [sx, sy, sz], v });
      }
    }
  }
  const tris: number[] = [];
  const push = (a: number[], b: number[], d: number[]) => {
    // Outward winding (the chunk is convex around its centre).
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const ad = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
    const n = [ab[1]! * ad[2]! - ab[2]! * ad[1]!, ab[2]! * ad[0]! - ab[0]! * ad[2]!, ab[0]! * ad[1]! - ab[1]! * ad[0]!];
    const m = [a[0]! + b[0]! + d[0]!, a[1]! + b[1]! + d[1]!, a[2]! + b[2]! + d[2]!];
    if (n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]! < 0) tris.push(...a, ...d, ...b);
    else tris.push(...a, ...b, ...d);
  };
  // Corner facets.
  for (const k of corners) push(k.v[0]!, k.v[1]!, k.v[2]!);
  // Faces: the two vertices of each of the face's four corners that lie in its plane, in order around it.
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [-1, 1]) {
      const ring: number[][] = [];
      for (const k of corners) {
        if (k.s[axis] !== side) continue;
        for (let e = 0; e < 3; e++) if (e !== axis) ring.push(k.v[e]!);
      }
      const u = (axis + 1) % 3;
      const w = (axis + 2) % 3;
      ring.sort((p, q) => Math.atan2(p[w]!, p[u]!) - Math.atan2(q[w]!, q[u]!));
      for (let i = 1; i < ring.length - 1; i++) push(ring[0]!, ring[i]!, ring[i + 1]!);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(tris), 3));
  g.computeVertexNormals();
  return g;
}

/** The ragged bed of crushed stone a breach leaves on the ground, draped on the relief. */
export function rubbleBedGeometry(f: SegmentFrame, seed: number, ground: (x: number, z: number) => number): BufferGeometry {
  const mid = { x: f.a.x + f.dir.x * (f.length / 2), z: f.a.z + f.dir.z * (f.length / 2) };
  const halfL = (f.length + BED_EXTRA_M) / 2;
  const halfD = BED_DEPTH_M / 2;
  const at = (k: number, scale: number) => {
    const a = (k / BED_SIDES) * Math.PI * 2;
    const r = scale * (1 + (hash01(seed, k, 70) - 0.5) * 2 * BED_RAGGED);
    const u = Math.cos(a) * halfL * r;
    const v = Math.sin(a) * halfD * r;
    const x = mid.x + f.dir.x * u + f.outward.x * v;
    const z = mid.z + f.dir.z * u + f.outward.z * v;
    return [x, ground(x, z) + BED_LIFT_M, z];
  };
  const centre = [mid.x, ground(mid.x, mid.z) + BED_LIFT_M, mid.z];
  const tris: number[] = [];
  for (let k = 0; k < BED_SIDES; k++) {
    const i0 = at(k, 0.55);
    const i1 = at(k + 1, 0.55);
    const o0 = at(k, 1);
    const o1 = at(k + 1, 1);
    // Counter-clockwise seen from above (normals up).
    tris.push(...centre, ...i1, ...i0, ...i0, ...i1, ...o1, ...i0, ...o1, ...o0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(tris), 3));
  g.computeVertexNormals();
  return finish(g, -BLOCK_PAINT_HEIGHT_M, new Color(BED_COLOR));
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

  constructor(blocks: readonly FallingBlock[], material: Material, name: string, seed = 0) {
    const unit = finish(chunkGeometry(seed), -BLOCK_PAINT_HEIGHT_M, new Color('#ffffff'));
    this.mesh = new InstancedMesh(unit, material, blocks.length);
    // Per-block tone; set even on an empty (warm-up) batch so its program variant is compiled.
    const tones = new Float32Array(Math.max(1, blocks.length) * 3);
    for (let i = 0; i < blocks.length; i++) {
      const t = BLOCK_TONE[0] + (BLOCK_TONE[1] - BLOCK_TONE[0]) * hash01(seed, i, 80);
      tones.set([t, t * (0.99 + 0.02 * hash01(seed, i, 81)), t * (0.97 + 0.03 * hash01(seed, i, 82))], i * 3);
    }
    if (blocks.length === 0) tones.fill(1);
    this.mesh.instanceColor = new InstancedBufferAttribute(tones, 3);
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
/** Stone dust, darker than the lit stone (a white ball read as a cartoon cloud). */
const DUST_COLOR = '#9e927e';
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
  // Soft foot: puffs born at the ground fade out at the bottom instead of being cut by it.
  alpha *= 1.0 - smoothstep(0.55, 1.0, gl_PointCoord.y);
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
      uniforms: { uColor: { value: new Color(DUST_COLOR) }, uPixelsPerMeter: { value: pixelsPerMeter } },
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
    setDrawable(this.points, false);
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
      setDrawable(this.points, true);
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
        if (this.live === 0) {
          this.points.geometry.setDrawRange(0, 0);
          setDrawable(this.points, false);
        }
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
