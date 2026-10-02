/**
 * The castle on screen: curtain walls, towers, keep, gatehouse and the bridges (castle-parts.ts),
 * merged by material — masonry (procedural stone), roofs and timber — plus, in battle, the parts
 * the siege moves (J4): the curtain walls in a mesh of their own (rebuilt when a segment comes
 * down), the cracks of damaged segments, the rubble of each breach, and per gate the doors, the
 * portcullis and the lifting span on their hinges. The battle drives them through a CastleHandle
 * (no React state per frame).
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Vector3, type Material, type PerspectiveCamera } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gateStructureId, wallSegmentId } from '../../core/battle/structures.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { BridgeSite, GateSite, KeepSite, StairSite, TowerSite, WallRun, WaterBody } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { assignShadowDepthMaterials } from '../materials/shadow-depth.ts';
import { buildCrenelShadowProxy, buildTowerGeometry, buildWallGeometry } from './castle-geometry.ts';
import { buildGate, buildGatePieces, buildKeep, buildStairs, buildStoneBridge, gateYaw } from './castle-parts.ts';
import { crackGeometry, DustPool, hash01, planCollapse, Rubble, segmentFrame } from './siege-fx.ts';
import { bundleCapacity, createBundleMesh, mineGeometry, placeBundles } from './siege-works-fx.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import { createStoneMaterial } from './stone-material.ts';

const TOWER_ROOF_HEIGHT_M = 16;
const TIMBER_HEIGHT_M = 6;
/** Lifting span raised (rad about the gate's across axis: tip up, leaning on the gatehouse). */
const LIFT_RAISED_RAD = -1.5;
/** Fallen doors and portcullis lie flat in the passage. */
const FALLEN_RAD = -Math.PI / 2 + 0.06;
const DOORS_FALL_S = 0.9;
const PORTCULLIS_FALL_S = 0.8;
const LIFT_FALL_S = 2.2;
const LIFT_BOUNCE_RAD = 0.05;
const KNOCK_S = 0.35;
const KNOCK_RAD = 0.035;
/** Dust: puffs per hit, per collapse metre; puff sizes (m). */
const HIT_PUFFS = 7;
const COLLAPSE_PUFFS_PER_M = 1.6;
const HIT_PUFF_M = 2.4;
const COLLAPSE_PUFF_M = 5;

/** A structure's condition as the battle shows it. */
export interface CastleSiegeState {
  readonly id: string;
  /** Remaining HP over maximum (1: intact). */
  readonly hpFraction: number;
  readonly broken: boolean;
}

/** A sappers' work as the castle shows it (built by the director from the core's sites). */
export type CastleWork =
  | {
      readonly kind: 'fill';
      readonly id: string;
      /** Work done over work needed. */
      readonly fraction: number;
      /** Centres of the slot's cells. */
      readonly cells: readonly Vec2[];
      /** The moat's direction at the slot (the bundles lie along it). */
      readonly tangent: Vec2;
      readonly surfaceM: number;
      readonly bedM: number;
    }
  | { readonly kind: 'mine'; readonly id: string; readonly fraction: number; readonly at: Vec2; readonly out: Vec2; readonly groundM: number };

/** What the battle director drives (BattleDirector, structure events). */
export interface CastleHandle {
  /** A sappers' work progresses (fascines pile up, the spoil heap grows). */
  setWork(work: CastleWork): void;
  /** A blow lands: cracks follow the remaining HP, dust flies where it struck. */
  hit(structureId: string, hpFraction: number): void;
  /** Plays a structure coming down; returns the duration (s). */
  bringDown(structureId: string): number;
  /** Where the structure's floating texts appear (world). */
  anchorOf(structureId: string, out: Vector3): boolean;
}

export interface CastleProps {
  readonly walls: readonly WallRun[];
  readonly towers: readonly TowerSite[];
  readonly gates: readonly GateSite[];
  readonly keeps: readonly KeepSite[];
  readonly bridges: readonly BridgeSite[];
  readonly water: readonly WaterBody[];
  readonly terrain: TerrainData;
  /** Stairs up to the wall-walks (battle castles). */
  readonly stairs?: readonly StairSite[];
  /** Battle: the structures' condition when the scene mounts (raised drawbridges unless broken). */
  readonly siege?: readonly CastleSiegeState[];
  readonly onHandle?: (handle: CastleHandle | null) => void;
}

function mergedMesh(parts: BufferGeometry[], material: Material, name: string): Mesh | null {
  if (parts.length === 0) return null;
  const geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!geometry) throw new Error(`${name}: merge failed`);
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

/** Stable defaults (a fresh [] each render would rebuild the castle every render). */
const NO_STAIRS: readonly StairSite[] = [];

interface GateRig {
  readonly gate: GateSite;
  readonly root: Group;
  readonly doors: Group;
  readonly portcullis: Group;
  readonly lift: Group | null;
}

interface Animation {
  t: number;
  readonly duration: number;
  update(t: number): void;
}

const easeIn = (k: number) => k * k;

export function Castle({ walls, towers, gates, keeps, bridges, water, terrain, stairs = NO_STAIRS, siege, onHandle }: CastleProps) {
  const size = useThree((s) => s.size);
  const built = useMemo(() => {
    const breached = new Set<string>(siege?.filter((s) => s.broken && s.id.startsWith('wall:')).map((s) => s.id) ?? []);
    const brokenGates = new Set<string>(siege?.filter((s) => s.broken && !s.id.startsWith('wall:')).map((s) => s.id) ?? []);
    const maxHeight = Math.max(...walls.map((w) => w.heightM), ...towers.map((t) => t.heightM), 1);
    const stone = createStoneMaterial(maxHeight);
    const roofMaterial = createPaintedMaterial({ name: 'Castle:roof', vertexColors: true, vertexData: true, heightM: TOWER_ROOF_HEIGHT_M, gradientBase: 0.6 });
    const wood = createPaintedMaterial({ name: 'Castle:wood', vertexColors: true, vertexData: true, heightM: TIMBER_HEIGHT_M, gradientBase: 0.85, groundAO: 0.1 });

    // Static masonry, roofs and timber.
    const stoneParts: BufferGeometry[] = [];
    const roofParts: BufferGeometry[] = [];
    const woodParts: BufferGeometry[] = [];
    for (const tower of towers) {
      const t = buildTowerGeometry(tower);
      stoneParts.push(t.stone);
      roofParts.push(t.roof);
    }
    const riverLevel = water.find((b) => b.kind === 'river')?.levelM ?? 0;
    const parts = [...keeps.map(buildKeep), ...gates.map((g) => buildGate(g, terrain)), ...bridges.map((b) => buildStoneBridge(b, terrain, riverLevel)), ...stairs.map(buildStairs)];
    for (const p of parts) {
      stoneParts.push(...p.stone);
      roofParts.push(...p.roof);
      woodParts.push(...p.wood);
    }
    const statics = [mergedMesh(roofParts, roofMaterial, 'Castle:roof'), mergedMesh(woodParts, wood, 'Castle:wood')].filter((m): m is Mesh => m !== null);
    // Towers, keep, lintels and bridges never change: merged once, then with the curtain walls
    // (rebuilt when a segment comes down) into the one masonry mesh.
    const staticStone = stoneParts.length > 0 ? mergeGeometries(stoneParts, false) : null;
    stoneParts.forEach((g) => g.dispose());

    // Curtain walls (rebuilt without the breached segments) and the crenel shadow band.
    const isBreached = (wallId: string, k: number) => breached.has(wallSegmentId(wallId, k));
    const masonryGeometry = () => {
      const g = walls.map((w) => {
        const skip = new Set<number>();
        for (let k = 0; k < w.points.length - 1; k++) if (isBreached(w.id, k)) skip.add(k);
        return buildWallGeometry(w, w.baseHeightM, true, skip);
      });
      const merged = g.length + (staticStone ? 1 : 0) > 0 ? mergeGeometries(staticStone ? [staticStone, ...g] : g, false) : null;
      g.forEach((x) => x.dispose());
      return merged;
    };
    const firstMasonry = masonryGeometry();
    const stoneMesh = firstMasonry ? new Mesh(firstMasonry, stone) : null;
    if (stoneMesh) {
      stoneMesh.name = 'Castle:stone';
      stoneMesh.castShadow = true;
      stoneMesh.receiveShadow = true;
    }
    const proxyMaterial = new MeshBasicMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false });
    const firstProxy = buildCrenelShadowProxy(walls, towers, isBreached);
    // Invisible in the view (writes neither colour nor depth), cast in the shadow pass: one band,
    // no comb. (three r186 filters shadow casters by the view camera's layers, so a layer cannot
    // hide it.)
    const proxy = firstProxy ? new Mesh(firstProxy, proxyMaterial) : null;
    if (proxy) {
      proxy.name = 'Castle:crenelShadow';
      proxy.castShadow = true;
    }

    // Moving gate parts, in each gate's local frame.
    const rigs: GateRig[] = gates.map((gate) => {
      const pieces = buildGatePieces(gate);
      const root = new Group();
      root.name = `Castle:gate:${gate.id}`;
      root.position.set(gate.center.x, gate.baseHeightM, gate.center.z);
      root.rotation.y = gateYaw(gate);
      const hinge = (geometry: BufferGeometry, z: number, name: string, material: Material, castShadow: boolean) => {
        const pivot = new Group();
        pivot.position.z = z;
        const mesh = new Mesh(geometry, material);
        mesh.name = name;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        pivot.add(mesh);
        root.add(pivot);
        return pivot;
      };
      // Doors and portcullis stand in the gatehouse's own shade: no shadow pass for them.
      const doors = hinge(pieces.doors, pieces.doorPivotZ, 'Castle:doors', wood, false);
      const portcullis = hinge(pieces.portcullis, pieces.portcullisPivotZ, 'Castle:portcullis', wood, false);
      const lift = pieces.lift ? hinge(pieces.lift, pieces.liftHingeZ, 'Castle:drawbridge', wood, true) : null;
      if (brokenGates.has(gateStructureId('gate', gate.id))) doors.rotation.x = FALLEN_RAD;
      if (brokenGates.has(gateStructureId('portcullis', gate.id))) portcullis.rotation.x = FALLEN_RAD;
      // Outside a battle the drawbridge is down.
      if (lift && siege && !brokenGates.has(gateStructureId('drawbridge', gate.id))) lift.rotation.x = LIFT_RAISED_RAD;
      return { gate, root, doors, portcullis, lift };
    });

    // Cracks are painted timber-material strips. The crack mesh and an empty rubble batch start in
    // the scene with nothing to draw (draw range 0: no draw call) so that their programs are
    // compiled behind the loading screen, not at the first blow.
    const crackMesh = new Mesh(warmUpTriangle(), wood);
    crackMesh.name = 'Castle:cracks';
    const dust = new DustPool(1);
    const rubbleGroup = new Group();
    rubbleGroup.name = 'Castle:rubble';
    const root = new Group();
    root.name = 'Castle';
    for (const m of statics) root.add(m);
    if (stoneMesh) root.add(stoneMesh);
    if (proxy) root.add(proxy);
    for (const r of rigs) root.add(r.root);
    root.add(crackMesh, dust.points, rubbleGroup);

    // --- Siege state, mutated by the handle ---------------------------------------------------
    const damage = new Map<string, number>();
    const rubble: Rubble[] = [];
    const animations: Animation[] = [];
    const ground = (x: number, z: number) => sampleHeight(terrain, x, z);
    const segmentOf = (id: string): { wall: WallRun; k: number } | null => {
      for (const wall of walls) for (let k = 0; k < wall.points.length - 1; k++) if (wallSegmentId(wall.id, k) === id) return { wall, k };
      return null;
    };
    const rigOf = (id: string): { rig: GateRig; part: 'gate' | 'portcullis' | 'drawbridge' } | null => {
      for (const rig of rigs) {
        for (const part of ['gate', 'portcullis', 'drawbridge'] as const) if (gateStructureId(part, rig.gate.id) === id) return { rig, part };
      }
      return null;
    };
    const seedOf = (id: string) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
      return h;
    };
    const rebuildCracks = () => {
      const g: BufferGeometry[] = [];
      for (const [id, d] of damage) {
        const seg = segmentOf(id);
        if (!seg || breached.has(id)) continue;
        const crack = crackGeometry(segmentFrame(seg.wall, seg.k), seedOf(id), d);
        if (crack) g.push(crack);
      }
      const merged = g.length > 0 ? mergeGeometries(g, false) : null;
      g.forEach((x) => x.dispose());
      crackMesh.geometry.dispose();
      crackMesh.geometry = merged ?? warmUpTriangle();
    };
    const addRubble = (id: string, settled: boolean): Rubble | null => {
      const seg = segmentOf(id);
      if (!seg) return null;
      const r = new Rubble(planCollapse(segmentFrame(seg.wall, seg.k), seedOf(id), ground), stone, `Castle:rubble:${id}`);
      r.pose(settled ? r.duration : 0);
      assignShadowDepthMaterials(r.mesh);
      rubbleGroup.add(r.mesh);
      rubble.push(r);
      return r;
    };
    const warmUp = new Rubble([], stone, 'Castle:rubble:warm-up');
    warmUp.mesh.geometry.setDrawRange(0, 0);
    assignShadowDepthMaterials(warmUp.mesh);
    rubbleGroup.add(warmUp.mesh);
    rubble.push(warmUp);
    for (const id of breached) addRubble(id, true);
    // Sappers' works: fascine piles (instanced timber, warmed up empty) and the mines' sheds.
    const worksGroup = new Group();
    worksGroup.name = 'Castle:works';
    const bundleWarmUp = createBundleMesh(wood, 1, 'Castle:fascines:warm-up');
    bundleWarmUp.geometry.setDrawRange(0, 0);
    assignShadowDepthMaterials(bundleWarmUp);
    worksGroup.add(bundleWarmUp);
    root.add(worksGroup);
    const fills = new Map<string, ReturnType<typeof createBundleMesh>>();
    const mines = new Map<string, Mesh>();
    for (const s of siege ?? []) if (!s.broken && s.hpFraction < 1) damage.set(s.id, 1 - s.hpFraction);
    rebuildCracks();

    const puffAlong = (wall: WallRun, k: number, count: number, sizeM: number, seed: number) => {
      const f = segmentFrame(wall, k);
      for (let i = 0; i < count; i++) {
        const u = f.length * hash01(seed, i, 11);
        const x = f.a.x + f.dir.x * u;
        const z = f.a.z + f.dir.z * u;
        dust.emit(x, f.base + f.height * 0.25 * hash01(seed, i, 12), z, 1, f.thickness, sizeM);
      }
    };
    const play = (duration: number, update: (t: number) => void) => {
      animations.push({ t: 0, duration, update });
      return duration;
    };

    const handle: CastleHandle = {
      setWork(work) {
        if (work.kind === 'fill') {
          let mesh = fills.get(work.id);
          if (!mesh) {
            mesh = createBundleMesh(wood, bundleCapacity(work.cells.length), `Castle:fascines:${work.id}`);
            assignShadowDepthMaterials(mesh);
            worksGroup.add(mesh);
            fills.set(work.id, mesh);
          }
          placeBundles(mesh, work.cells, work.tangent, work.surfaceM, work.bedM, work.fraction, seedOf(work.id));
          const c = work.cells[Math.floor(work.cells.length / 2)];
          if (c) dust.emit(c.x, work.surfaceM - 0.5, c.z, HIT_PUFFS - 3, 1.5, HIT_PUFF_M * 0.7);
          return;
        }
        const previous = mines.get(work.id);
        if (previous) previous.geometry.dispose();
        const geometry = mineGeometry(work.at, work.groundM, work.out, work.fraction);
        const mesh = previous ?? new Mesh(geometry, wood);
        mesh.geometry = geometry;
        if (!previous) {
          mesh.name = `Castle:mine:${work.id}`;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          assignShadowDepthMaterials(mesh);
          worksGroup.add(mesh);
          mines.set(work.id, mesh);
        }
        dust.emit(work.at.x, work.groundM + 0.5, work.at.z, HIT_PUFFS - 3, 1.2, HIT_PUFF_M * 0.6);
      },
      hit(id, hpFraction) {
        const seg = segmentOf(id);
        if (seg) {
          damage.set(id, 1 - hpFraction);
          rebuildCracks();
          const f = segmentFrame(seg.wall, seg.k);
          const seed = seedOf(id) + damage.size * 7919 + Math.round(hpFraction * 1000);
          const u = f.length * (0.25 + 0.5 * hash01(seed, 1));
          dust.emit(f.a.x + f.dir.x * u + f.outward.x * f.thickness * 0.6, f.base + f.height * (0.4 + 0.4 * hash01(seed, 2)), f.a.z + f.dir.z * u + f.outward.z * f.thickness * 0.6, HIT_PUFFS, 1.2, HIT_PUFF_M);
          return;
        }
        const g = rigOf(id);
        if (!g) return;
        const piece = g.part === 'portcullis' ? g.rig.portcullis : g.rig.doors;
        const rest = piece.rotation.x;
        const p = g.rig.root.position;
        dust.emit(p.x, p.y + 2.5, p.z, HIT_PUFFS - 2, 1.4, HIT_PUFF_M * 0.8);
        play(KNOCK_S, (t) => {
          piece.rotation.x = rest - KNOCK_RAD * Math.sin((t / KNOCK_S) * Math.PI * 3) * (1 - t / KNOCK_S);
        });
      },
      bringDown(id) {
        const seg = segmentOf(id);
        if (seg) {
          breached.add(id);
          damage.delete(id);
          // The sappers' shed goes down with the wall it undermined.
          const mine = mines.get(`mine:${id}`);
          if (mine) {
            worksGroup.remove(mine);
            mine.geometry.dispose();
            mines.delete(`mine:${id}`);
          }
          rebuildCracks();
          const nextMasonry = masonryGeometry();
          if (stoneMesh && nextMasonry) {
            stoneMesh.geometry.dispose();
            stoneMesh.geometry = nextMasonry;
          }
          const nextProxy = buildCrenelShadowProxy(walls, towers, isBreached);
          if (proxy && nextProxy) {
            proxy.geometry.dispose();
            proxy.geometry = nextProxy;
          }
          const r = addRubble(id, false);
          const seed = seedOf(id);
          const length = segmentFrame(seg.wall, seg.k).length;
          puffAlong(seg.wall, seg.k, Math.ceil(length * COLLAPSE_PUFFS_PER_M * 0.5), COLLAPSE_PUFF_M, seed);
          let second = false;
          const duration = r ? r.duration : 1;
          return play(duration, (t) => {
            r?.pose(t);
            if (!second && t > duration * 0.45) {
              second = true;
              puffAlong(seg.wall, seg.k, Math.ceil(length * COLLAPSE_PUFFS_PER_M * 0.5), COLLAPSE_PUFF_M * 1.2, seed + 1);
            }
          });
        }
        const g = rigOf(id);
        if (!g) return 0;
        const p = g.rig.root.position;
        if (g.part === 'drawbridge') {
          const lift = g.rig.lift;
          if (!lift) return 0;
          const from = lift.rotation.x;
          let landed = false;
          return play(LIFT_FALL_S, (t) => {
            const k = Math.min(1, t / (LIFT_FALL_S * 0.82));
            const bounce = k >= 1 ? Math.sin(((t - LIFT_FALL_S * 0.82) / (LIFT_FALL_S * 0.18)) * Math.PI) * LIFT_BOUNCE_RAD : 0;
            lift.rotation.x = from * (1 - easeIn(k)) - Math.max(0, bounce);
            if (!landed && k >= 1) {
              landed = true;
              const out = new Vector3(0, 0, 4.5).applyAxisAngle(UP, g.rig.root.rotation.y);
              dust.emit(p.x + out.x, p.y, p.z + out.z, HIT_PUFFS, 2.5, HIT_PUFF_M);
            }
          });
        }
        const piece = g.part === 'gate' ? g.rig.doors : g.rig.portcullis;
        const fall = g.part === 'gate' ? DOORS_FALL_S : PORTCULLIS_FALL_S;
        const from = piece.rotation.x;
        dust.emit(p.x, p.y + 1.5, p.z, HIT_PUFFS, 1.8, HIT_PUFF_M);
        let landed = false;
        return play(fall, (t) => {
          piece.rotation.x = from + (FALLEN_RAD - from) * easeIn(t / fall);
          if (!landed && t >= fall) {
            landed = true;
            dust.emit(p.x, p.y + 0.3, p.z, HIT_PUFFS, 2, HIT_PUFF_M * 1.2);
          }
        });
      },
      anchorOf(id, out) {
        const seg = segmentOf(id);
        if (seg) {
          const f = segmentFrame(seg.wall, seg.k);
          out.set(f.a.x + f.dir.x * f.length * 0.5, f.base + f.height + 1.5, f.a.z + f.dir.z * f.length * 0.5);
          return true;
        }
        const g = rigOf(id);
        if (!g) return false;
        out.copy(g.rig.root.position);
        out.y += 6;
        return true;
      },
    };

    const step = (dt: number) => {
      for (let i = animations.length - 1; i >= 0; i--) {
        const a = animations[i] as Animation;
        a.t = Math.min(a.duration, a.t + dt);
        a.update(a.t);
        if (a.t >= a.duration) animations.splice(i, 1);
      }
      dust.update(dt);
    };
    const dispose = () => {
      root.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
      for (const r of rubble) r.dispose();
      dust.dispose();
      staticStone?.dispose();
      for (const m of [stone, roofMaterial, wood, proxyMaterial]) m.dispose();
    };
    return { root, handle, step, dispose, dust };
    // `siege` is read once, when the castle is built (the battle then drives it by the handle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls, towers, gates, keeps, bridges, water, terrain, stairs]);

  useEffect(() => {
    onHandle?.(built.handle);
    return () => onHandle?.(null);
  }, [built, onHandle]);
  useEffect(() => () => built.dispose(), [built]);

  useFrame((state, delta) => {
    const camera = state.camera as PerspectiveCamera;
    // Point sprites are sized in pixels: metres at unit depth for the current view.
    built.dust.setPixelsPerMeter(size.height / (2 * Math.tan(((camera.fov ?? 50) * Math.PI) / 360)));
    built.step(Math.min(delta, 0.1) * TIME_SCALE);
  });

  return <primitive object={built.root} />;
}

const UP = new Vector3(0, 1, 0);

/** A zero-area triangle with the castle's attributes and nothing to draw (keeps a mesh compiled, costs no draw call). */
function warmUpTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(9), 3));
  g.setAttribute('aPaintedData', new BufferAttribute(new Float32Array(12), 4));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
  g.setDrawRange(0, 0);
  return g;
}

/** Tests (`?fast`) play the battle animations this much faster (same switch as BattleDirector). */
const TIME_SCALE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fast') ? 8 : 1;
