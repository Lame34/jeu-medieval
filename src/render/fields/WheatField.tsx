/**
 * Wheat and rye fields (brief §7, ADR-055), the same mass at every distance and in every corner of
 * the screen. Each parcel has a canopy (field-canopy.ts): a painted surface at the crop's height,
 * waves of wind rolling across it, charred where it burnt. Near the camera, instanced tufts of
 * stalks and ears take over: generated per 16 m chunk on demand (deterministic hash, no global
 * state), the visible chunks nearest the camera first, at two levels of detail (full tufts close,
 * sparse wider tufts further out), one InstancedMesh per crop and level. Over a band before the
 * preset's distance the canopy first rises under the whole tufts, then the tufts thin out one by one
 * above it, their ears standing out of the mass (vertex shaders): there is no edge to see.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, Frustum, InstancedMesh, Matrix4, Mesh, NearestFilter, Quaternion, RGBAFormat, Sphere, UnsignedByteType, Vector2, Vector3, type Camera } from 'three';
import { createSimplex, type Noise2D } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { distanceToPolygonEdge, pointInPolygon } from '../../core/worldgen/geometry.ts';
import type { FieldPatch } from '../../core/worldgen/types.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import type { SeasonPalette } from '../materials/season-palette.ts';
import { BURNING_TINT, BURNT_HEIGHT, BURNT_MIX, BURNT_TINT, burnTufts, fieldBurn } from './field-burn.ts';
import { buildCanopyGeometry, EDGE_FADE_M } from './field-canopy.ts';
import { keepOutOfReflections } from '../water/reflection.ts';

const SPACING_M = 0.34;
const STALKS = 7;
const FAR_STALKS = 3;
const TUFT_HEIGHT_M = 1.05;
const STALK_WIDTH_M = 0.1;
const EAR_LENGTH_M = 0.26;
const EAR_WIDTH_M = 0.14;
const WHEAT_SWAY_M = 0.2;
const UP = new Vector3(0, 1, 0);

/** Streaming: chunk size and the radius of its bounding sphere (m, tuft jitter and height included). */
const CHUNK_M = 16;
const CHUNK_RADIUS_M = CHUNK_M * Math.SQRT1_2 + 1.5;
/** The band before the preset's distance (m): the canopy rises over its first half, the tufts thin out over the second. */
const TUFTS_FADE_M = 16;
/** Chunks nearer the camera than this share of the tufts' distance use full tufts. */
const NEAR_SHARE = 0.6;
/** Far level: three tufts in five, twice as wide: the mass without the triangles. */
const FAR_KEEP = 0.6;
const FAR_WIDTH = 2.4;
/**
 * Instance caps per crop at the portable preset's 40 m (the triangle budget), grown with the area
 * within reach up to MAX_CAPACITY_SCALE: the visible chunks nearest the camera are served first.
 */
const NEAR_CAPACITY = 5000;
const FAR_CAPACITY = 9000;
const CAPACITY_REFERENCE_M = 40;
const MAX_CAPACITY_SCALE = 4;
/** The camera must move this far, or turn this much, before the streamed set is rebuilt. */
const REBUILD_STEP_M = 3;
const REBUILD_TURN_COS = Math.cos((4 * Math.PI) / 180);
/** Where the tufts stand, the canopy sinks this far under the ground (hidden by the terrain). */
const CANOPY_SINK_M = 0.15;
/** The canopy's top leans with the swell by this share of its height. */
const CANOPY_LEAN = 0.05;
const FLOATS_PER_MATRIX = 16;
/** New chunks generated per frame at most (no hitch while panning under CPU throttling). */
const NEW_CHUNKS_PER_FRAME = 6;

type Crop = 'wheat' | 'rye';
const CROPS: readonly Crop[] = ['wheat', 'rye'];

/** A tuft of `stalks` stalks `heightM` high, with their ears (none on young wheat or stubble). */
function tuftGeometry(lit: string, base: string, stalks: number, heightM: number, ears: boolean): BufferGeometry {
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
    const h = heightM * rng.float(0.8, 1.1);
    const earM = ears ? EAR_LENGTH_M : 0;
    const offset = new Vector3(rng.float(-0.12, 0.12), 0, rng.float(-0.12, 0.12));
    const side = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(STALK_WIDTH_M / 2);
    const top = offset.clone().add(lean).setY(h - earM);
    quad(offset.clone().sub(side), offset.clone().add(side), top.clone().add(side.clone().multiplyScalar(0.5)), top.clone().sub(side.clone().multiplyScalar(0.5)), cBase, cLit);
    if (!ears) continue;
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
  /** The tufts as the fire left them, and the fire version they were made for. */
  burnt: ChunkTufts | null;
  burntVersion: number;
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
    return { ...e, x, z, y: sampleHeight(terrain, Math.min(W, Math.max(0, x)), Math.min(D, Math.max(0, z))), tufts: null, burnt: null, burntVersion: -1 };
  });
}

const FIELD_VERTEX_PARS = /* glsl */ `
uniform float uTuftsM;
uniform float uTuftsFade;
`;

/**
 * Over the band's second half, above the risen canopy, the tufts thin out: each leaves at its own
 * distance (a hash of its place), shrinking quickly, so the field's grain fades rather than ends.
 */
const FIELD_VERTEX_BODY = /* glsl */ `
{
  vec4 origin = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
  origin = instanceMatrix * origin;
  #endif
  origin = modelMatrix * origin;
  float thin = mix(-0.1, 1.1, smoothstep(uTuftsM - 0.5 * uTuftsFade, uTuftsM, distance(origin.xyz, cameraPosition)));
  transformed *= clamp((paintedHash12(floor(origin.xz * 9.0)) - thin) * 8.0, 0.0, 1.0);
  // Wind waves: a value swell rolls across the field.
  #ifdef USE_COLOR
  vColor.rgb *= 1.0 + 0.1 * paintedWindSwell(origin.xz);
  #endif
}
`;

const glslVec3 = (v: readonly [number, number, number]) => `vec3(${v.map((x) => x.toFixed(3)).join(', ')})`;

const CANOPY_VERTEX_PARS = /* glsl */ `
uniform float uTuftsM;
uniform float uTuftsFade;
uniform sampler2D uBurnMap;
uniform vec2 uBurnMapSize;
varying float vCanopySwell;
`;

/**
 * The canopy stands at its height where the tufts are not drawn and sinks under the ground where
 * they are; burnt, it falls as the burnt tufts do; its top leans with the wind's swell.
 */
const CANOPY_VERTEX_BODY = /* glsl */ `
{
  float height = aPaintedData.x;
  float groundY = transformed.y - height;
  float rise = smoothstep(uTuftsM - uTuftsFade, uTuftsM - 0.5 * uTuftsFade, distance(transformed, cameraPosition));
  float burnt = texture2D(uBurnMap, transformed.xz / uBurnMapSize).r;
  float h = height * rise * mix(1.0, ${BURNT_HEIGHT.toFixed(2)}, burnt);
  transformed.y = groundY + h - ${CANOPY_SINK_M.toFixed(2)} * (1.0 - rise);
  // The tufts' swell, so the waves run on from the tufts to the canopy.
  vCanopySwell = paintedWindSwell(transformed.xz);
  transformed.xz += uWindDir * vCanopySwell * ${CANOPY_LEAN.toFixed(2)} * h;
}
`;

const CANOPY_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uBurnMap;
uniform vec2 uBurnMapSize;
varying float vCanopySwell;
`;

/**
 * The crop's grain as the tufts paint it from afar: mottled clumps of ears and their dark gaps, short
 * brush strokes leaning with the wind, the furrows' rows; patches riper or greener over the parcel;
 * the swell's light crests; shaded low in the stalks and towards the thinning border; charred by fire.
 * The finest marks fade to their mean where they would be smaller than a pixel (no shimmer).
 */
const CANOPY_ALBEDO = /* glsl */ `
{
  vec3 c = diffuseColor.rgb;
  float top = clamp(vPaintedHeight / max(uBoundsY.y, 1e-3), 0.0, 1.0);
  vec2 p = vPaintedWorldPos.xz;
  float fine = 1.0 - smoothstep(0.035, 0.12, length(fwidth(p)));
  // Rotated off the world grid: the value noise's lattice must not read as squares.
  vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * p;
  float tufts = mix(0.5, smoothstep(0.2, 0.8, paintedFbm(q * 2.6 + 2.0)), fine);
  float ears = smoothstep(0.74, 0.9, paintedValueNoise(q * 5.7 + 9.0)) * fine;
  float clumps = smoothstep(0.2, 0.8, paintedFbm(q * 0.55 + 7.0));
  vec2 wind = normalize(uWindDir + vec2(1e-4));
  float strokes = mix(0.5, paintedValueNoise(vec2(dot(p, wind) * 0.8, dot(p, vec2(-wind.y, wind.x)) * 3.4) + 11.0), fine);
  float rows = 0.5 + 0.5 * sin(dot(p, vec2(-vPaintedData.z, vPaintedData.y)) * 8.976);
  c *= 0.8 + 0.18 * tufts + 0.08 * clumps + 0.1 * strokes + 0.04 * rows * fine;
  c *= 1.0 + 0.28 * ears;
  float ripe = paintedFbm(p / 17.0 + 3.0);
  c = max(paintedHueShift(c, (ripe - 0.5) * 0.05), 0.0) * (0.92 + 0.16 * ripe);
  c *= mix(0.62, 1.1, smoothstep(0.0, 1.0, top));
  c *= mix(0.76, 1.0, vPaintedData.w);
  c *= 1.0 + 0.1 * vCanopySwell;
  c = mix(c, c * 1.22 + 0.02, smoothstep(0.65, 1.0, vCanopySwell) * 0.3);
  float n = paintedFbm(p * uHueNoiseScale);
  c = max(paintedHueShift(c, (n - 0.5) * 2.0 * uHueNoiseAmp), 0.0);
  c *= 1.0 + (n - 0.5) * 2.0 * uValueNoiseAmp;
  vec2 fire = texture2D(uBurnMap, p / uBurnMapSize).rg;
  c = mix(c, ${glslVec3(BURNT_TINT)}, fire.r * ${BURNT_MIX.toFixed(2)});
  c *= mix(vec3(1.0), ${glslVec3(BURNING_TINT)}, fire.g);
  diffuseColor.rgb = c;
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
  readonly canopy: Mesh;
  /** The fire over the battle grid (r: burnt, g: burning), read by the canopy. */
  readonly burnMap: DataTexture;
  readonly tuftsM: number;
  readonly last: { camera: Vector3; forward: Vector3 };
  /** The fire version the streamed set and the burn map were built with. */
  readonly fireVersion: { value: number };
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
  // Thousands of tufts for a mirror that would hardly show them.
  keepOutOfReflections(mesh);
  return { mesh, capacity };
}

function build(fields: readonly FieldPatch[], terrain: TerrainData, season: SeasonPalette, tuftsM: number): Built {
  const heightM = TUFT_HEIGHT_M * season.cropHeight;
  const fade = { uTuftsM: { value: tuftsM }, uTuftsFade: { value: TUFTS_FADE_M } };
  const material = createPaintedMaterial({
    name: 'Fields',
    ground: true,
    vertexColors: true,
    heightM,
    windSwayM: WHEAT_SWAY_M,
    gradientBase: 0.6,
    gradientTop: 1.12,
    groundAO: 0.15,
    side: DoubleSide,
    keepNormalOnBackFaces: true,
    customVertex: {
      key: 'field-stream-v2',
      pars: FIELD_VERTEX_PARS,
      body: FIELD_VERTEX_BODY,
      uniforms: fade,
    },
  });
  const geometries: BufferGeometry[] = [];
  const levels = {} as Record<Crop, { near: Level; far: Level }>;
  const capacity = Math.min(MAX_CAPACITY_SCALE, (tuftsM / CAPACITY_REFERENCE_M) ** 2);
  for (const crop of CROPS) {
    const palette = crop === 'wheat' ? season.wheat : season.rye;
    const nearGeo = tuftGeometry(palette.lit, palette.base, STALKS, heightM, season.ears);
    const farGeo = tuftGeometry(palette.lit, palette.base, FAR_STALKS, heightM, season.ears);
    geometries.push(nearGeo, farGeo);
    levels[crop] = {
      near: makeLevel(nearGeo, material, Math.round(NEAR_CAPACITY * capacity), `Fields:${crop}:near`),
      far: makeLevel(farGeo, material, Math.round(FAR_CAPACITY * capacity), `Fields:${crop}:far`),
    };
  }
  const burnMap = new DataTexture(new Uint8Array(terrain.width * terrain.depth * 4), terrain.width, terrain.depth, RGBAFormat, UnsignedByteType);
  burnMap.magFilter = NearestFilter;
  burnMap.minFilter = NearestFilter;
  burnMap.needsUpdate = true;
  const fire = { uBurnMap: { value: burnMap }, uBurnMapSize: { value: new Vector2(terrain.width * terrain.cellSize, terrain.depth * terrain.cellSize) } };
  const canopyMaterial = createPaintedMaterial({
    name: 'FieldCanopy',
    ground: true,
    vertexColors: true,
    vertexData: true,
    heightM,
    groundAO: 0,
    customVertex: { key: 'field-canopy-v1', pars: CANOPY_VERTEX_PARS, body: CANOPY_VERTEX_BODY, uniforms: { ...fade, ...fire } },
    customAlbedo: { key: 'field-canopy-v1', pars: CANOPY_FRAGMENT_PARS, body: CANOPY_ALBEDO, uniforms: fire },
  });
  const crops = fields.filter((field) => field.crop !== 'fallow').map((field) => ({ field, tone: field.crop === 'wheat' ? season.wheat : season.rye }));
  const canopy = new Mesh(buildCanopyGeometry(crops, terrain, heightM), canopyMaterial);
  canopy.name = 'FieldCanopy';
  // A metre of crop casts no shadow worth its two draws and its triangles in each cascade; it receives them.
  canopy.receiveShadow = true;
  const inf = Number.POSITIVE_INFINITY;
  return { chunks: chunksOf(fields, terrain), levels, material, geometries, canopy, burnMap, tuftsM, last: { camera: new Vector3(inf, 0, 0), forward: new Vector3() }, fireVersion: { value: -1 } };
}

/** The fire's cells into the canopy's burn map. */
function paintBurnMap(map: DataTexture): void {
  const data = map.image.data as Uint8Array;
  data.fill(0);
  const { width, burnt, burning } = fieldBurn;
  if (width > 0) {
    for (const cell of burnt) data[cell * 4] = 255;
    for (const cell of burning) data[cell * 4 + 1] = 255;
  }
  map.needsUpdate = true;
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
const frustum = new Frustum();
const viewProjection = new Matrix4();
const chunkSphere = new Sphere();

/** A chunk's tufts through the fire (field-burn.ts), cached per fire version. */
function burntTuftsOf(chunk: CropChunk, tufts: ChunkTufts): ChunkTufts {
  if (chunk.burntVersion !== fieldBurn.version) {
    const near = burnTufts(tufts.near, tufts.nearColor);
    const far = burnTufts(tufts.far, tufts.farColor);
    chunk.burnt = near.matrices === tufts.near && far.matrices === tufts.far ? null : { near: near.matrices, nearColor: near.colors, far: far.matrices, farColor: far.colors };
    chunk.burntVersion = fieldBurn.version;
  }
  return chunk.burnt ?? tufts;
}

/**
 * The tufts of the visible chunks within reach of the camera, nearest first. Returns false when some
 * chunks are still to be generated (rebuild again next frame).
 */
function rebuild(built: Built, camera: Camera, terrain: TerrainData): boolean {
  const reach = (built.tuftsM + CHUNK_RADIUS_M) ** 2;
  const nearM = built.tuftsM * NEAR_SHARE;
  const eye = camera.position;
  frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  byDistance.length = 0;
  for (const chunk of built.chunks) {
    const dx = chunk.x - eye.x;
    const dy = chunk.y - eye.y;
    const dz = chunk.z - eye.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > reach) continue;
    chunkSphere.center.set(chunk.x, chunk.y, chunk.z);
    chunkSphere.radius = CHUNK_RADIUS_M;
    if (frustum.intersectsSphere(chunkSphere)) byDistance.push({ chunk, d2 });
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
    const near = Math.hypot(chunk.x - eye.x, chunk.y - eye.y, chunk.z - eye.z) < nearM;
    const tufts = burntTuftsOf(chunk, chunk.tufts);
    if (near) f.near = append(level.near, f.near, tufts.near, tufts.nearColor);
    else f.far = append(level.far, f.far, tufts.far, tufts.farColor);
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

const forward = new Vector3();

/** `tuftsM`: the tufts are drawn within this distance of the camera (the quality preset's), the canopy beyond. */
export function Fields({ fields, terrain, season, tuftsM }: { readonly fields: readonly FieldPatch[]; readonly terrain: TerrainData; readonly season: SeasonPalette; readonly tuftsM: number }) {
  const built = useMemo(() => build(fields, terrain, season, tuftsM), [fields, terrain, season, tuftsM]);
  // The terrain's field bed takes the crop's mass where the tufts end.
  useEffect(() => {
    paintedGlobals.uCropTuftsM.value = tuftsM;
  }, [tuftsM]);

  useFrame(({ camera }) => {
    const { last } = built;
    const fireMoved = built.fireVersion.value !== fieldBurn.version;
    camera.getWorldDirection(forward);
    if (!fireMoved && last.camera.distanceToSquared(camera.position) < REBUILD_STEP_M ** 2 && last.forward.dot(forward) > REBUILD_TURN_COS) return;
    if (fireMoved) paintBurnMap(built.burnMap);
    built.fireVersion.value = fieldBurn.version;
    last.camera.copy(camera.position);
    last.forward.copy(forward);
    // Unfinished (chunks still to generate): force another pass next frame.
    if (!rebuild(built, camera, terrain)) last.camera.setScalar(Number.POSITIVE_INFINITY);
  });

  useEffect(
    () => () => {
      built.geometries.forEach((g) => g.dispose());
      built.material.dispose();
      built.canopy.geometry.dispose();
      (built.canopy.material as PaintedMaterial).dispose();
      built.burnMap.dispose();
      for (const crop of CROPS) {
        built.levels[crop].near.mesh.dispose();
        built.levels[crop].far.mesh.dispose();
      }
    },
    [built],
  );

  return (
    <>
      <primitive object={built.canopy} />
      {CROPS.flatMap((crop) => [built.levels[crop].near.mesh, built.levels[crop].far.mesh]).map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </>
  );
}
