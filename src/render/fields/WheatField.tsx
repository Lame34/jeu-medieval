/**
 * Wheat and rye fields, streamed around the camera focus (brief §7): instanced tufts of stalks
 * with ears on a world-aligned jittered grid clipped to each parcel with a noisy, thinning
 * edge. Tufts are generated per 16 m chunk on demand (deterministic hash, no global state) and
 * drawn at two levels of detail (full tufts near the camera, sparse wider tufts further out),
 * one InstancedMesh per crop and level. Beyond the streaming disk the painted field bed of the
 * terrain carries the crop; tufts sink into it over the outer ring (vertex shader), so there
 * is no popping edge. The painted wind (phase = world position) rolls waves across the field.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { createSimplex, type Noise2D } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { distanceToPolygonEdge, pointInPolygon } from '../../core/worldgen/geometry.ts';
import type { FieldPatch } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';

const SPACING_M = 0.34;
const EDGE_FADE_M = 2.2;
const STALKS = 7;
const FAR_STALKS = 3;
const TUFT_HEIGHT_M = 1.05;
const STALK_WIDTH_M = 0.1;
const EAR_LENGTH_M = 0.26;
const EAR_WIDTH_M = 0.14;
const WHEAT_SWAY_M = 0.2;
const UP = new Vector3(0, 1, 0);

/** Streaming: chunk size, disk radius around the focus and its fading outer ring (m). */
const CHUNK_M = 16;
const STREAM_RADIUS_M = 55;
const STREAM_FADE_M = 17;
/** Chunks whose centre is closer than this to the camera use full tufts. */
const NEAR_DISTANCE_M = 30;
/** Far level: three tufts in five, twice as wide: the mass without the triangles. */
const FAR_KEEP = 0.6;
const FAR_WIDTH = 2.4;
/** Instance caps per crop (the triangle budget): nearest chunks are served first. */
const NEAR_CAPACITY = 5000;
const FAR_CAPACITY = 9000;
/** The focus or the camera must move this far before the streamed set is rebuilt. */
const REBUILD_STEP_M = 3;
const FLOATS_PER_MATRIX = 16;
/** New chunks generated per frame at most (no hitch while panning under CPU throttling). */
const NEW_CHUNKS_PER_FRAME = 6;

type Crop = 'wheat' | 'rye';
const CROPS: readonly Crop[] = ['wheat', 'rye'];

function tuftGeometry(lit: string, base: string, stalks: number): BufferGeometry {
  const rng = Rng.create(`wheat-tuft:${stalks}`);
  const positions: number[] = [];
  const colors: number[] = [];
  const cLit = new Color(lit);
  const cBase = new Color(base);
  const earColor = new Color(lit).offsetHSL(0, -0.04, 0.06);
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, ca: Color, cb: Color) => {
    for (const [p, col] of [
      [a, ca],
      [b, ca],
      [c, cb],
      [a, ca],
      [c, cb],
      [d, cb],
    ] as const) {
      positions.push(p.x, p.y, p.z);
      colors.push(col.r, col.g, col.b);
    }
  };
  for (let s = 0; s < stalks; s++) {
    const angle = (s / stalks) * Math.PI + rng.float(-0.3, 0.3);
    const lean = new Vector3(rng.float(-0.12, 0.12), 0, rng.float(-0.12, 0.12));
    const h = TUFT_HEIGHT_M * rng.float(0.8, 1.1);
    const offset = new Vector3(rng.float(-0.12, 0.12), 0, rng.float(-0.12, 0.12));
    const side = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(STALK_WIDTH_M / 2);
    const top = offset.clone().add(lean).setY(h - EAR_LENGTH_M);
    quad(offset.clone().sub(side), offset.clone().add(side), top.clone().add(side.clone().multiplyScalar(0.5)), top.clone().sub(side.clone().multiplyScalar(0.5)), cBase, cLit);
    const earSide = side.clone().normalize().multiplyScalar(EAR_WIDTH_M / 2);
    const earTop = top.clone().add(lean.clone().multiplyScalar(0.4)).setY(h);
    quad(top.clone().sub(earSide), top.clone().add(earSide), earTop.clone().add(earSide.clone().multiplyScalar(0.3)), earTop.clone().sub(earSide.clone().multiplyScalar(0.3)), earColor, earColor);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  // Stalk normals point up-ish: fields read as a soft lit mass, not as flickering cards.
  const nor = g.getAttribute('normal');
  const n = new Vector3();
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i).lerp(UP, 0.35).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

/** Deterministic [0, 1) hash of a grid point (chunks are generated independently). */
function hash01(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface FieldInfo {
  readonly field: FieldPatch;
  readonly crop: Crop;
  readonly noise: Noise2D;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Tufts of one crop in one chunk: instance matrices and colours, both levels. */
interface ChunkTufts {
  readonly near: Float32Array;
  readonly nearColor: Float32Array;
  readonly far: Float32Array;
  readonly farColor: Float32Array;
}

interface CropChunk {
  readonly crop: Crop;
  readonly cx: number;
  readonly cz: number;
  readonly fields: readonly FieldInfo[];
  /** Chunk centre (terrain height at the centre). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  tufts: ChunkTufts | null;
}

const scratch = { m: new Matrix4(), q: new Quaternion(), s: new Vector3(), p: new Vector3() };

function generateTufts(chunk: CropChunk, terrain: TerrainData): ChunkTufts {
  const near: number[] = [];
  const nearColor: number[] = [];
  const far: number[] = [];
  const farColor: number[] = [];
  const { m, q, s, p } = scratch;
  const x0 = chunk.cx * CHUNK_M;
  const z0 = chunk.cz * CHUNK_M;
  const i0 = Math.ceil(x0 / SPACING_M);
  const i1 = Math.ceil((x0 + CHUNK_M) / SPACING_M);
  const j0 = Math.ceil(z0 / SPACING_M);
  const j1 = Math.ceil((z0 + CHUNK_M) / SPACING_M);
  for (const info of chunk.fields) {
    const salt = info.field.id.length * 131 + info.field.id.charCodeAt(info.field.id.length - 1);
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const x = i * SPACING_M + (hash01(i, j, salt) - 0.5) * 0.36;
        const z = j * SPACING_M + (hash01(i, j, salt + 1) - 0.5) * 0.36;
        if (x < info.minX || x > info.maxX || z < info.minZ || z > info.maxZ) continue;
        const spot = { x, z };
        if (!pointInPolygon(spot, info.field.polygon)) continue;
        const edge = distanceToPolygonEdge(spot, info.field.polygon);
        const keep = Math.min(1, edge / EDGE_FADE_M) + info.noise(x * 0.3, z * 0.3) * 0.35;
        if (hash01(i, j, salt + 2) > keep) continue;
        const height = Math.min(1, 0.55 + edge / EDGE_FADE_M) * (0.85 + 0.25 * hash01(i, j, salt + 3));
        const v = 0.9 + 0.2 * (info.noise(x * 0.08, z * 0.08) * 0.5 + 0.5);
        p.set(x, sampleHeight(terrain, x, z) - 0.05, z);
        q.setFromAxisAngle(UP, hash01(i, j, salt + 4) * Math.PI * 2);
        s.set(1, height, 1);
        near.push(...m.compose(p, q, s).elements);
        nearColor.push(v, v, v * 0.97);
        if (hash01(i, j, salt + 5) < FAR_KEEP) {
          s.set(FAR_WIDTH, height, FAR_WIDTH);
          far.push(...m.compose(p, q, s).elements);
          farColor.push(v, v, v * 0.97);
        }
      }
    }
  }
  return { near: new Float32Array(near), nearColor: new Float32Array(nearColor), far: new Float32Array(far), farColor: new Float32Array(farColor) };
}

/** Every (crop, chunk) pair touched by a field bounding box. */
function chunksOf(fields: readonly FieldPatch[], terrain: TerrainData): CropChunk[] {
  const byKey = new Map<string, { crop: Crop; cx: number; cz: number; fields: FieldInfo[] }>();
  for (const field of fields) {
    if (field.crop === 'fallow') continue;
    const crop: Crop = field.crop === 'wheat' ? 'wheat' : 'rye';
    const xs = field.polygon.map((v) => v.x);
    const zs = field.polygon.map((v) => v.z);
    const info: FieldInfo = {
      field,
      crop,
      noise: createSimplex(Rng.create(`field:${field.id}`).fork('edge')),
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    };
    for (let cz = Math.floor(info.minZ / CHUNK_M); cz <= Math.floor(info.maxZ / CHUNK_M); cz++) {
      for (let cx = Math.floor(info.minX / CHUNK_M); cx <= Math.floor(info.maxX / CHUNK_M); cx++) {
        const key = `${crop}:${cx}:${cz}`;
        const entry = byKey.get(key) ?? { crop, cx, cz, fields: [] };
        entry.fields.push(info);
        byKey.set(key, entry);
      }
    }
  }
  return [...byKey.values()].map((e) => {
    const x = (e.cx + 0.5) * CHUNK_M;
    const z = (e.cz + 0.5) * CHUNK_M;
    const W = terrain.width * terrain.cellSize;
    const D = terrain.depth * terrain.cellSize;
    return { ...e, x, z, y: sampleHeight(terrain, Math.min(W, Math.max(0, x)), Math.min(D, Math.max(0, z))), tufts: null };
  });
}

const FIELD_VERTEX_PARS = /* glsl */ `
uniform float uStreamRadius;
uniform float uStreamFade;
`;

/** Tufts shrink into the painted field bed over the outer ring of the streaming disk. */
const FIELD_VERTEX_BODY = /* glsl */ `
{
  vec4 origin = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
  origin = instanceMatrix * origin;
  #endif
  origin = modelMatrix * origin;
  float fade = 1.0 - smoothstep(uStreamRadius - uStreamFade, uStreamRadius, distance(origin.xz, uFocus.xz));
  transformed *= fade;
  // Wind waves: a value swell (12 m wavelength, 1.5 m/s) rolls across the field.
  #ifdef USE_COLOR
  float swell = sin(dot(origin.xz, uWindDir) * 0.5236 - uTime * 0.785);
  vColor.rgb *= 1.0 + 0.1 * swell;
  #endif
}
`;

interface Level {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
}

interface Built {
  readonly chunks: CropChunk[];
  readonly levels: Record<Crop, { near: Level; far: Level }>;
  readonly material: PaintedMaterial;
  readonly geometries: BufferGeometry[];
  readonly last: { focus: Vector3; camera: Vector3 };
}

function makeLevel(geometry: BufferGeometry, material: PaintedMaterial, capacity: number, name: string): Level {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  // Initialise the colour buffer (three creates it lazily on the first setColorAt).
  mesh.setColorAt(0, new Color(1, 1, 1));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = name;
  return { mesh, capacity };
}

function build(fields: readonly FieldPatch[], terrain: TerrainData): Built {
  const material = createPaintedMaterial({
    name: 'Fields',
    vertexColors: true,
    heightM: TUFT_HEIGHT_M,
    windSwayM: WHEAT_SWAY_M,
    gradientBase: 0.6,
    gradientTop: 1.12,
    groundAO: 0.15,
    side: DoubleSide,
    keepNormalOnBackFaces: true,
    customVertex: {
      key: 'field-stream-v1',
      pars: FIELD_VERTEX_PARS,
      body: FIELD_VERTEX_BODY,
      uniforms: { uStreamRadius: { value: STREAM_RADIUS_M }, uStreamFade: { value: STREAM_FADE_M } },
    },
  });
  const geometries: BufferGeometry[] = [];
  const levels = {} as Record<Crop, { near: Level; far: Level }>;
  for (const crop of CROPS) {
    const palette = crop === 'wheat' ? PALETTE.wheat : PALETTE.rye;
    const nearGeo = tuftGeometry(palette.lit, palette.base, STALKS);
    const farGeo = tuftGeometry(palette.lit, palette.base, FAR_STALKS);
    geometries.push(nearGeo, farGeo);
    levels[crop] = {
      near: makeLevel(nearGeo, material, NEAR_CAPACITY, `Fields:${crop}:near`),
      far: makeLevel(farGeo, material, FAR_CAPACITY, `Fields:${crop}:far`),
    };
  }
  const inf = Number.POSITIVE_INFINITY;
  return { chunks: chunksOf(fields, terrain), levels, material, geometries, last: { focus: new Vector3(inf, 0, 0), camera: new Vector3(inf, 0, 0) } };
}

/** Copies one chunk level into an instanced level; returns the new fill count. */
function append(level: Level, filled: number, matrices: Float32Array, colors: Float32Array): number {
  const count = matrices.length / FLOATS_PER_MATRIX;
  if (count === 0 || filled + count > level.capacity) return filled;
  level.mesh.instanceMatrix.array.set(matrices, filled * FLOATS_PER_MATRIX);
  level.mesh.instanceColor?.array.set(colors, filled * 3);
  return filled + count;
}

const byDistance: { chunk: CropChunk; d2: number }[] = [];

/** Returns false when some chunks are still to be generated (rebuild again next frame). */
function rebuild(built: Built, focus: Vector3, camera: Vector3, terrain: TerrainData): boolean {
  const reach = (STREAM_RADIUS_M + CHUNK_M * Math.SQRT1_2) ** 2;
  byDistance.length = 0;
  for (const chunk of built.chunks) {
    const dx = chunk.x - focus.x;
    const dz = chunk.z - focus.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= reach) byDistance.push({ chunk, d2 });
  }
  byDistance.sort((a, b) => a.d2 - b.d2);
  const fill: Record<Crop, { near: number; far: number }> = { wheat: { near: 0, far: 0 }, rye: { near: 0, far: 0 } };
  let generated = 0;
  let complete = true;
  for (const { chunk } of byDistance) {
    if (!chunk.tufts) {
      if (generated >= NEW_CHUNKS_PER_FRAME) {
        complete = false;
        continue;
      }
      chunk.tufts = generateTufts(chunk, terrain);
      generated++;
    }
    const level = built.levels[chunk.crop];
    const f = fill[chunk.crop];
    const near = Math.hypot(chunk.x - camera.x, chunk.y - camera.y, chunk.z - camera.z) < NEAR_DISTANCE_M;
    if (near) f.near = append(level.near, f.near, chunk.tufts.near, chunk.tufts.nearColor);
    else f.far = append(level.far, f.far, chunk.tufts.far, chunk.tufts.farColor);
  }
  for (const crop of CROPS) {
    for (const key of ['near', 'far'] as const) {
      const { mesh } = built.levels[crop][key];
      const count = fill[crop][key];
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, count * FLOATS_PER_MATRIX);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.visible = count > 0;
    }
  }
  return complete;
}

export function Fields({ fields, terrain }: { readonly fields: readonly FieldPatch[]; readonly terrain: TerrainData }) {
  const built = useMemo(() => build(fields, terrain), [fields, terrain]);

  useFrame(({ camera }) => {
    const focus = paintedGlobals.uFocus.value;
    const { last } = built;
    if (last.focus.distanceToSquared(focus) < REBUILD_STEP_M ** 2 && last.camera.distanceToSquared(camera.position) < REBUILD_STEP_M ** 2) return;
    last.focus.copy(focus);
    last.camera.copy(camera.position);
    // Unfinished (chunks still to generate): force another pass next frame.
    if (!rebuild(built, focus, camera.position, terrain)) last.focus.setScalar(Number.POSITIVE_INFINITY);
  });

  useEffect(
    () => () => {
      built.geometries.forEach((g) => g.dispose());
      built.material.dispose();
      for (const crop of CROPS) {
        built.levels[crop].near.mesh.dispose();
        built.levels[crop].far.mesh.dispose();
      }
    },
    [built],
  );

  return (
    <>
      {CROPS.flatMap((crop) => [built.levels[crop].near.mesh, built.levels[crop].far.mesh]).map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </>
  );
}
