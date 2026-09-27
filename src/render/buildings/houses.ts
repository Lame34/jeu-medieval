/**
 * House recipes (brief §6.2): every house is assembled from the village kit on its 2 m grid —
 * ground floor in rough brick or plaster, timber-framed upper floor, kit tile roof or a
 * procedural thatch roof, gables, chimney, door and shutters — plus a yard (wagon, crates,
 * fence) behind it — then merged per material so a whole village costs a handful of draw calls.
 */
import { Box3, BufferAttribute, BufferGeometry, Color, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/rng.ts';
import { TerrainLayer } from '../../core/rules/types.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { HouseSite } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';
import type { Kit } from './kit.ts';

export const MODULE_M = 2;
export const FLOOR_HEIGHT_M = 3.12;
/** Wall pieces: exterior face at local z = +0.09. */
const WALL_OUTSET_M = 0.09;
const PLINTH_DEPTH_M = 1.2;
/** Barely proud of the ground: a taller plinth read as a black outline in the shade. */
const PLINTH_HEIGHT_M = 0.02;
const PLINTH_MARGIN_M = 0.25;
const THATCH_OVERHANG_M = 0.7;
const THATCH_THICKNESS_M = 0.38;
/** Gable apex height above the roof base for the kit's Roof_Front_Brick{W} pieces. */
const GABLE_HEIGHT: Readonly<Record<number, number>> = { 4: 2.94, 6: 4.38 };
const TILE_ROOFS = new Set(['4x4', '4x6', '4x8', '6x6', '6x8']);

/** Material key for procedural geometry (vertex coloured). */
export const PROCEDURAL_MATERIAL = 'Procedural';

interface Placement {
  readonly piece: string;
  readonly local: Matrix4;
}

const Y = new Vector3(0, 1, 0);

/** Yard props stand on free ground only (not on roads, fields, water or other buildings). */
const YARD_BLOCKING: ReadonlySet<number> = new Set([
  TerrainLayer.Road,
  TerrainLayer.Bridge,
  TerrainLayer.Field,
  TerrainLayer.River,
  TerrainLayer.Moat,
  TerrainLayer.Ford,
  TerrainLayer.Wall,
  TerrainLayer.Hedge,
  TerrainLayer.DryStoneWall,
]);
const YARD_SINK_M = 0.03;
const YARD_BACK_M = 2.4;

/** Wagon, a few crates and a fence run behind the house (local frame: front is +z). */
function yard(site: HouseSite, rng: Rng, fenceWidthM: number): Placement[] {
  const W = site.widthM;
  const D = site.depthM;
  const out: Placement[] = [];
  const side = rng.chance(0.5) ? 1 : -1;
  if (rng.chance(0.65)) out.push({ piece: 'Prop_Wagon', local: at(side * (W / 2 + 1.6), 0, rng.float(-D / 4, D / 4), (Math.PI / 2) * side + rng.float(-0.25, 0.25)) });
  const crates = rng.int(1, 3);
  for (let k = 0; k < crates; k++) {
    out.push({ piece: 'Prop_Crate', local: at(-side * (W / 2 - 0.6 - k * 0.95), 0, -D / 2 - 0.75, rng.float(-0.3, 0.3)) });
  }
  if (rng.chance(0.7) && fenceWidthM > 0.2) {
    const run = Math.max(1, Math.floor((W + 2) / fenceWidthM));
    for (let k = 0; k < run; k++) out.push({ piece: 'Prop_WoodenFence_Single', local: at(-(run * fenceWidthM) / 2 + fenceWidthM * (k + 0.5), 0, -D / 2 - YARD_BACK_M - 1.2, 0) });
  }
  return out;
}

function pieceWidth(kit: Kit, piece: string): number {
  const parts = kit.pieces.get(piece);
  if (!parts) return 0;
  const box = new Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
  }
  return box.max.x - box.min.x;
}

function at(x: number, y: number, z: number, rotY = 0): Matrix4 {
  return new Matrix4().makeRotationAxis(Y, rotY).setPosition(x, y, z);
}

function recipe(site: HouseSite, rng: Rng): { placements: Placement[]; thatch: boolean } {
  const W = site.widthM;
  const D = site.depthM;
  const brickGround = rng.chance(0.55);
  const placements: Placement[] = [];
  const doorSide = rng.chance(0.5) ? 'front' : 'side';

  for (let floor = 0; floor < site.floors; floor++) {
    const y = floor * FLOOR_HEIGHT_M;
    const brick = floor === 0 && brickGround;
    const family = brick ? 'Wall_UnevenBrick' : 'Wall_Plaster';
    const pick = (isDoor: boolean): string => {
      if (isDoor) return `${family}_Door_Round`;
      const roll = rng.next();
      if (roll < 0.45) return `${family}_Window_Wide_Round`;
      if (!brick && roll < 0.65) return 'Wall_Plaster_Window_Thin_Round';
      if (!brick && floor > 0 && roll < 0.9) return 'Wall_Plaster_WoodGrid';
      return `${family}_Straight`;
    };
    const sides = [
      { name: 'front', count: W / MODULE_M, rot: 0, pos: (i: number) => [-W / 2 + MODULE_M / 2 + i * MODULE_M, D / 2 - WALL_OUTSET_M] as const },
      { name: 'back', count: W / MODULE_M, rot: Math.PI, pos: (i: number) => [W / 2 - MODULE_M / 2 - i * MODULE_M, -D / 2 + WALL_OUTSET_M] as const },
      { name: 'side', count: D / MODULE_M, rot: Math.PI / 2, pos: (i: number) => [W / 2 - WALL_OUTSET_M, D / 2 - MODULE_M / 2 - i * MODULE_M] as const },
      { name: 'side2', count: D / MODULE_M, rot: -Math.PI / 2, pos: (i: number) => [-W / 2 + WALL_OUTSET_M, -D / 2 + MODULE_M / 2 + i * MODULE_M] as const },
    ];
    for (const side of sides) {
      const doorIndex = floor === 0 && side.name === doorSide ? Math.floor(side.count / 2) : -1;
      for (let i = 0; i < side.count; i++) {
        const [x, z] = side.pos(i);
        const piece = pick(i === doorIndex);
        placements.push({ piece, local: at(x, y, z, side.rot) });
        if (piece.endsWith('Window_Wide_Round') && rng.chance(0.5)) placements.push({ piece: 'WindowShutters_Wide_Round_Open', local: at(x, y, z, side.rot) });
        if (piece.endsWith('Window_Thin_Round') && rng.chance(0.4)) placements.push({ piece: 'WindowShutters_Thin_Round_Closed', local: at(x, y, z, side.rot) });
        if (i === doorIndex) placements.push({ piece: 'Door_1_Round', local: at(x - 0.5, y, z, side.rot) });
      }
    }
    const corner = brick ? 'Corner_Exterior_Brick' : 'Corner_Exterior_Wood';
    for (const [cx, cz, r] of [
      [W / 2, D / 2, 0],
      [-W / 2, D / 2, -Math.PI / 2],
      [-W / 2, -D / 2, Math.PI],
      [W / 2, -D / 2, Math.PI / 2],
    ] as const) {
      placements.push({ piece: corner, local: at(cx, y, cz, r) });
    }
  }

  const roofY = site.floors * FLOOR_HEIGHT_M;
  const tileKey = `${W}x${D}`;
  const thatch = site.roof === 'thatch' || !TILE_ROOFS.has(tileKey);
  if (!thatch) placements.push({ piece: `Roof_RoundTiles_${tileKey}`, local: at(0, roofY, 0) });
  if (GABLE_HEIGHT[W] !== undefined) {
    placements.push({ piece: `Roof_Front_Brick${W}`, local: at(0, roofY, D / 2 - WALL_OUTSET_M) });
    placements.push({ piece: `Roof_Front_Brick${W}`, local: at(0, roofY, -D / 2 + WALL_OUTSET_M, Math.PI) });
  }
  const chimneySide = rng.chance(0.5) ? 1 : -1;
  placements.push({ piece: rng.chance(0.5) ? 'Prop_Chimney' : 'Prop_Chimney2', local: at((chimneySide * W) / 4, roofY + 0.4, -D / 4) });
  return { placements, thatch };
}

/** Gable thatch roof: a thick, slightly sagging prism with generous rounded eaves. */
function thatchRoof(W: number, D: number, baseY: number): BufferGeometry {
  const halfW = W / 2 + THATCH_OVERHANG_M;
  const halfD = D / 2 + THATCH_OVERHANG_M * 0.6;
  const ridge = baseY + (GABLE_HEIGHT[W] ?? W * 0.72) + THATCH_THICKNESS_M * 0.6;
  const eave = baseY - 0.35;
  const segmentsD = Math.max(4, Math.round(D * 2));
  const positions: number[] = [];
  const colors: number[] = [];
  const lit = new Color(PALETTE.thatch.lit);
  const base = new Color(PALETTE.thatch.base);
  const push = (x: number, y: number, z: number, shade: number) => {
    positions.push(x, y, z);
    const c = base.clone().lerp(lit, shade);
    colors.push(c.r, c.g, c.b);
  };
  const sag = (t: number) => Math.sin(t * Math.PI) * 0.12;
  for (const side of [-1, 1]) {
    for (let k = 0; k < segmentsD; k++) {
      const z0 = -halfD + (2 * halfD * k) / segmentsD;
      const z1 = -halfD + (2 * halfD * (k + 1)) / segmentsD;
      const s0 = sag(k / segmentsD);
      const s1 = sag((k + 1) / segmentsD);
      // Top surface quad (eave → ridge), then the thick eave edge.
      const e0 = [side * halfW, eave, z0] as const;
      const e1 = [side * halfW, eave, z1] as const;
      const r0 = [0, ridge - s0, z0] as const;
      const r1 = [0, ridge - s1, z1] as const;
      const quad = side > 0 ? [e0, e1, r1, e0, r1, r0] : [e0, r0, r1, e0, r1, e1];
      for (const [i, p] of quad.entries()) push(p[0], p[1], p[2], p[0] === 0 ? 0.95 : 0.55 + 0.1 * (i % 2));
      const u0 = [side * halfW, eave - THATCH_THICKNESS_M, z0] as const;
      const u1 = [side * halfW, eave - THATCH_THICKNESS_M, z1] as const;
      const edge = side > 0 ? [u0, u1, e1, u0, e1, e0] : [u0, e0, e1, u0, e1, u1];
      for (const p of edge) push(p[0], p[1], p[2], 0.25);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  return g;
}

/** Stone plinth under the walls: anchors the house on sloped ground (no floating). */
function plinth(W: number, D: number): BufferGeometry {
  const w = W / 2 + PLINTH_MARGIN_M;
  const d = D / 2 + PLINTH_MARGIN_M;
  const top = PLINTH_HEIGHT_M;
  const bottom = -PLINTH_DEPTH_M;
  const c = new Color(PALETTE.dirt.base);
  const corners = [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ] as const;
  const positions: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i] as readonly [number, number];
    const [bx, bz] = corners[(i + 1) % 4] as readonly [number, number];
    positions.push(ax, bottom, az, ax, top, az, bx, top, bz, ax, bottom, az, bx, top, bz, bx, bottom, bz);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  return g;
}

/** aPaintedData.w flag: 1 = thatch (straw strands in the painted albedo). */
const THATCH_FLAG = 1;

function withData(g: BufferGeometry, world: Matrix4, baseY: number, hue: number, value: number, flag = 0): BufferGeometry {
  const out = g.clone();
  out.applyMatrix4(world);
  const pos = out.getAttribute('position');
  const data = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    data[i * 4] = pos.getY(i) - baseY;
    data[i * 4 + 1] = hue;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = flag;
  }
  out.setAttribute('aPaintedData', new BufferAttribute(data, 4));
  if (!out.getAttribute('color')) {
    const white = new Float32Array(pos.count * 3).fill(1);
    out.setAttribute('color', new BufferAttribute(white, 3));
  }
  return out.index ? out.toNonIndexed() : out;
}

/** Builds every house and returns one merged geometry per material key. */
export function buildHouses(sites: readonly HouseSite[], kit: Kit, terrain?: TerrainData): Map<string, BufferGeometry> {
  const byMaterial = new Map<string, BufferGeometry[]>();
  const add = (key: string, g: BufferGeometry) => {
    const list = byMaterial.get(key) ?? [];
    list.push(g);
    byMaterial.set(key, list);
  };
  const fenceWidthM = pieceWidth(kit, 'Prop_WoodenFence_Single');
  const origin = new Vector3();
  for (const site of sites) {
    const rng = Rng.create(`house:${site.id}:${site.seed}`);
    const world = new Matrix4().makeRotationAxis(Y, site.rotationTurns * 2 * Math.PI).setPosition(site.center.x, site.baseHeightM, site.center.z);
    const hue = rng.float(-1, 1);
    const value = rng.float(-1, 1);
    const { placements, thatch } = recipe(site, rng);
    for (const placement of placements) {
      const parts = kit.pieces.get(placement.piece);
      if (!parts) throw new Error(`village kit: missing piece ${placement.piece}`);
      const m = world.clone().multiply(placement.local);
      for (const part of parts) add(part.material, withData(part.geometry, m, site.baseHeightM, hue, value));
    }
    add(PROCEDURAL_MATERIAL, withData(plinth(site.widthM, site.depthM), world, site.baseHeightM, hue, value));
    if (terrain) {
      for (const placement of yard(site, Rng.create(`yard:${site.id}:${site.seed}`), fenceWidthM)) {
        const parts = kit.pieces.get(placement.piece);
        if (!parts) continue;
        const m = world.clone().multiply(placement.local);
        origin.setFromMatrixPosition(m);
        const cx = Math.floor(origin.x);
        const cz = Math.floor(origin.z);
        if (cx < 0 || cz < 0 || cx >= terrain.width || cz >= terrain.depth) continue;
        if (YARD_BLOCKING.has(terrain.layers[cz * terrain.width + cx] as number)) continue;
        // Props sit on the real ground (the house pad is flattened, the yard is not).
        m.elements[13] = sampleHeight(terrain, origin.x, origin.z) - YARD_SINK_M;
        for (const part of parts) add(part.material, withData(part.geometry, m, site.baseHeightM, hue, value));
      }
    }
    if (thatch) add(PROCEDURAL_MATERIAL, withData(thatchRoof(site.widthM, site.depthM, site.floors * FLOOR_HEIGHT_M), world, site.baseHeightM, hue, value, THATCH_FLAG));
  }
  const merged = new Map<string, BufferGeometry>();
  for (const [key, list] of byMaterial) {
    const g = mergeGeometries(list, false);
    list.forEach((p) => p.dispose());
    if (!g) throw new Error(`house merge failed for ${key}`);
    g.computeBoundingSphere();
    merged.set(key, g);
  }
  return merged;
}
