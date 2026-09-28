/**
 * Decorative props at human scale (review v18, #11): mossy half-buried rocks, haystacks and
 * fallen logs. Procedural, vertex-coloured, merged into one PaintedMaterial mesh (one draw
 * call); `aPaintedData` carries the height above the ground (gradient, contact AO), a per-prop
 * hue/value jitter and the straw strands of the haystacks.
 */
import { useEffect, useMemo } from 'react';
import { BufferAttribute, Color, CylinderGeometry, IcosahedronGeometry, LatheGeometry, Matrix4, Mesh, Quaternion, Vector2, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { PropSite } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { PALETTE } from '../materials/palette.ts';

const ROCK_DETAIL = 2;
/** Rock proportions: radius multipliers (x, y, z) and the buried fraction of the height. */
const ROCK_SQUASH = { x: [1, 1.4], y: [0.65, 0.95], z: [0.75, 1.05] } as const;
const ROCK_BURY = 0.22;
const ROCK_BUMPS = 4;
const ROCK_BUMP_AMP = 0.16;
/** Moss on the upward faces (normal.y beyond the threshold), broken by noise. */
const MOSS_FACING = [0.55, 0.9] as const;
const MOSS_AMOUNT = 0.6;
const LICHEN_COLOR = '#b8ad8a';
const HAYSTACK_SEGMENTS = 14;
/** Haystack profile (radius, height) in m, bottom to top. */
const HAYSTACK_PROFILE: readonly [number, number][] = [
  [1.0, -0.25],
  [1.12, 0.35],
  [1.12, 0.9],
  [0.98, 1.5],
  [0.7, 2.05],
  [0.35, 2.45],
  [0.12, 2.62],
];
/** Pole through the top of the stack (m). */
const HAYSTACK_POLE = { radius: 0.045, from: 2.2, to: 3.0 } as const;
/** Straw laid in courses: value banding per metre of height. */
const HAYSTACK_COURSES_PER_M = 2.5;
const STRAW_COLOR = '#b88f4c';
const HAYSTACK_WOBBLE = 0.07;
const LOG_LENGTH_M = 3.4;
const LOG_RADII_M = [0.3, 0.36] as const;
const LOG_SEGMENTS = 10;
const LOG_SINK_M = 0.1;
const BARK_COLOR = '#6f5a45';
const HEARTWOOD_COLOR = PALETTE.woodLight.lit;
const PROPS_HEIGHT_M = 1.4;
const PROPS_GRADIENT_BASE = 0.86;
const PROPS_GROUND_AO = 0.22;
const PROP_JITTER = 1;

const UP = new Vector3(0, 1, 0);

/** Smooth pseudo-random field on the unit sphere (a few random plane waves). */
function bumpField(rng: Rng): (d: Vector3) => number {
  const waves = Array.from({ length: ROCK_BUMPS }, () => ({
    k: new Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1)).normalize().multiplyScalar(rng.float(1.5, 3.5)),
    phase: rng.float(0, Math.PI * 2),
    amp: rng.float(0.5, 1),
  }));
  return (d) => waves.reduce((sum, w) => sum + w.amp * Math.sin(d.dot(w.k) + w.phase), 0) / ROCK_BUMPS;
}

function rockGeometry(rng: Rng, radius: number): BufferGeometry {
  const src = new IcosahedronGeometry(1, ROCK_DETAIL);
  src.deleteAttribute('normal');
  src.deleteAttribute('uv');
  const g = mergeVertices(src);
  src.dispose();
  const bump = bumpField(rng);
  const sx = rng.float(...ROCK_SQUASH.x);
  const sy = rng.float(...ROCK_SQUASH.y);
  const sz = rng.float(...ROCK_SQUASH.z);
  const pos = g.getAttribute('position');
  const d = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i);
    const r = radius * (1 + ROCK_BUMP_AMP * bump(d) * 2);
    // Flattened sole (the rock sits in the ground, it does not balance on a point).
    const y = Math.max(d.y, -0.55);
    pos.setXYZ(i, d.x * r * sx, (y * sy - ROCK_BURY * sy) * r, d.z * r * sz);
  }
  g.computeVertexNormals();
  return g;
}

function haystackGeometry(rng: Rng): BufferGeometry {
  const src = new LatheGeometry(
    HAYSTACK_PROFILE.map(([r, h]) => new Vector2(r, h)),
    HAYSTACK_SEGMENTS,
  );
  src.deleteAttribute('uv');
  src.deleteAttribute('normal');
  const straw = mergeVertices(src);
  src.dispose();
  const bump = bumpField(rng);
  const pos = straw.getAttribute('position');
  const d = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i);
    const k = 1 + HAYSTACK_WOBBLE * bump(d.clone().normalize()) * 2;
    pos.setXYZ(i, d.x * k, d.y, d.z * k);
  }
  straw.computeVertexNormals();
  const pole = new CylinderGeometry(HAYSTACK_POLE.radius * 0.7, HAYSTACK_POLE.radius, HAYSTACK_POLE.to - HAYSTACK_POLE.from, 5, 1, true);
  pole.deleteAttribute('uv');
  pole.translate(0, (HAYSTACK_POLE.from + HAYSTACK_POLE.to) / 2, 0);
  const g = mergeGeometries([straw, pole], false);
  straw.dispose();
  pole.dispose();
  if (!g) throw new Error('haystack merge failed');
  return g;
}

function logGeometry(rng: Rng): BufferGeometry {
  const g = new CylinderGeometry(LOG_RADII_M[0] * rng.float(0.9, 1.1), LOG_RADII_M[1] * rng.float(0.9, 1.1), LOG_LENGTH_M, LOG_SEGMENTS, 1, false);
  g.deleteAttribute('uv');
  g.rotateZ(Math.PI / 2);
  g.translate(0, LOG_RADII_M[1] - LOG_SINK_M, 0);
  return g;
}

/** Vertex colours: stone or bark with moss on top, straw for haystacks, heartwood on log ends. */
function paint(g: BufferGeometry, site: PropSite, rng: Rng): void {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const data = new Float32Array(pos.count * 4);
  const stone = new Color(PALETTE.stone.lit);
  const moss = new Color(PALETTE.moss.lit);
  const lichen = new Color(LICHEN_COLOR);
  const straw = new Color(STRAW_COLOR);
  const poleWood = new Color(PALETTE.woodWarm.base);
  const bark = new Color(BARK_COLOR);
  const heart = new Color(HEARTWOOD_COLOR);
  const mossBump = bumpField(rng);
  const hue = rng.float(-PROP_JITTER, PROP_JITTER);
  const value = rng.float(-PROP_JITTER, PROP_JITTER);
  const c = new Color();
  const d = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i);
    const ny = nrm.getY(i);
    const n = mossBump(d.clone().normalize());
    const facing = Math.min(1, Math.max(0, (ny - MOSS_FACING[0]) / (MOSS_FACING[1] - MOSS_FACING[0])));
    const mossy = Math.min(1, Math.max(0, facing * 1.3 + n * 1.2 - 0.35));
    let strands = 0;
    if (site.kind === 'rock') {
      c.copy(stone).lerp(lichen, Math.max(0, -n) * 0.45).lerp(moss, mossy * MOSS_AMOUNT);
    } else if (site.kind === 'haystack') {
      if (Math.hypot(d.x, d.z) < HAYSTACK_POLE.radius * 1.5) c.copy(poleWood);
      else {
        // Straw in courses, darker at the weathered foot.
        const course = 0.9 + 0.1 * Math.sin(d.y * HAYSTACK_COURSES_PER_M * Math.PI * 2);
        c.copy(straw).multiplyScalar(course * (0.78 + 0.22 * Math.min(1, Math.max(0, d.y / 1.2))));
        strands = 1;
      }
    } else {
      const end = Math.abs(nrm.getX(i)) > 0.9;
      c.copy(end ? heart : bark).lerp(moss, end ? 0 : mossy * 0.6);
    }
    colors.set([c.r, c.g, c.b], i * 3);
    data.set([d.y, hue, value, strands], i * 4);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.setAttribute('aPaintedData', new BufferAttribute(data, 4));
}

function buildProps(props: readonly PropSite[], terrain: TerrainData): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  props.forEach((site, index) => {
    const rng = Rng.create(`prop:${site.kind}:${index}`);
    const g = site.kind === 'rock' ? rockGeometry(rng, site.scale) : site.kind === 'haystack' ? haystackGeometry(rng) : logGeometry(rng);
    const local = g.index ? g.toNonIndexed() : g;
    if (local !== g) g.dispose();
    paint(local, site, rng);
    // Seat the prop on the lowest ground under its footprint (no lip showing on a slope).
    const reach = site.kind === 'log' ? LOG_LENGTH_M / 2 : site.kind === 'haystack' ? 1 : site.scale;
    const { x, z } = site.position;
    const ground = Math.min(
      sampleHeight(terrain, x, z),
      ...[0, 1, 2, 3].map((k) => sampleHeight(terrain, x + Math.cos((k * Math.PI) / 2) * reach * 0.7, z + Math.sin((k * Math.PI) / 2) * reach * 0.7)),
    );
    const scale = site.kind === 'rock' ? 1 : site.scale;
    local.applyMatrix4(m.compose(p.set(x, ground, z), q.setFromAxisAngle(UP, site.rotationTurns * Math.PI * 2), s.setScalar(scale)));
    parts.push(local);
  });
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

export function Props({ props, terrain }: { readonly props: readonly PropSite[]; readonly terrain: TerrainData }) {
  const mesh = useMemo(() => {
    const geometry = buildProps(props, terrain);
    if (!geometry) return null;
    const material = createPaintedMaterial({ name: 'Props', vertexColors: true, vertexData: true, heightM: PROPS_HEIGHT_M, gradientBase: PROPS_GRADIENT_BASE, groundAO: PROPS_GROUND_AO, groundAOHeightM: 0.5 });
    const out = new Mesh(geometry, material);
    out.name = 'Props';
    out.castShadow = true;
    out.receiveShadow = true;
    return out;
  }, [props, terrain]);

  useEffect(
    () => () => {
      if (!mesh) return;
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    },
    [mesh],
  );

  return mesh ? <primitive object={mesh} /> : null;
}
