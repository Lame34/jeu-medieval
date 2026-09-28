/**
 * The castle on screen: curtain walls, towers, keep, gatehouse and the bridges (castle-parts.ts),
 * merged into three meshes — masonry (procedural stone), roofs and timber — so the whole castle
 * costs three draw calls (plus the shadow pass).
 */
import { useEffect, useMemo } from 'react';
import { DoubleSide, Mesh, MeshBasicMaterial, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { BridgeSite, GateSite, KeepSite, TowerSite, WallRun, WaterBody } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { buildCrenelShadowProxy, buildTowerGeometry, buildWallGeometry } from './castle-geometry.ts';
import { buildGate, buildKeep, buildStoneBridge } from './castle-parts.ts';
import { createStoneMaterial } from './stone-material.ts';

const TOWER_ROOF_HEIGHT_M = 16;
const TIMBER_HEIGHT_M = 6;

export interface CastleProps {
  readonly walls: readonly WallRun[];
  readonly towers: readonly TowerSite[];
  readonly gates: readonly GateSite[];
  readonly keeps: readonly KeepSite[];
  readonly bridges: readonly BridgeSite[];
  readonly water: readonly WaterBody[];
  readonly terrain: TerrainData;
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

export function Castle({ walls, towers, gates, keeps, bridges, water, terrain }: CastleProps) {
  const built = useMemo(() => {
    const stoneParts: BufferGeometry[] = walls.map((w) => buildWallGeometry(w));
    const roofParts: BufferGeometry[] = [];
    const woodParts: BufferGeometry[] = [];
    for (const tower of towers) {
      const { stone, roof } = buildTowerGeometry(tower);
      stoneParts.push(stone);
      roofParts.push(roof);
    }
    const riverLevel = water.find((b) => b.kind === 'river')?.levelM ?? 0;
    const parts = [...keeps.map(buildKeep), ...gates.map((g) => buildGate(g, terrain)), ...bridges.map((b) => buildStoneBridge(b, terrain, riverLevel))];
    for (const p of parts) {
      stoneParts.push(...p.stone);
      roofParts.push(...p.roof);
      woodParts.push(...p.wood);
    }
    const maxHeight = Math.max(...walls.map((w) => w.heightM), ...towers.map((t) => t.heightM), 1);
    const meshes = [
      mergedMesh(stoneParts, createStoneMaterial(maxHeight), 'Castle:stone'),
      mergedMesh(roofParts, createPaintedMaterial({ name: 'Castle:roof', vertexColors: true, vertexData: true, heightM: TOWER_ROOF_HEIGHT_M, gradientBase: 0.6 }), 'Castle:roof'),
      mergedMesh(woodParts, createPaintedMaterial({ name: 'Castle:wood', vertexColors: true, vertexData: true, heightM: TIMBER_HEIGHT_M, gradientBase: 0.85, groundAO: 0.1 }), 'Castle:wood'),
    ];
    const proxy = buildCrenelShadowProxy(walls, towers);
    if (proxy) {
      // Invisible in the view (writes neither colour nor depth), cast in the shadow pass: one
      // band, no comb. (three r186 filters shadow casters by the view camera's layers, so a
      // layer cannot hide it.)
      const mesh = new Mesh(proxy, new MeshBasicMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false }));
      mesh.name = 'Castle:crenelShadow';
      mesh.castShadow = true;
      meshes.push(mesh);
    }
    return meshes.filter((m): m is Mesh => m !== null);
  }, [walls, towers, gates, keeps, bridges, water, terrain]);

  useEffect(
    () => () => {
      for (const m of built) {
        m.geometry.dispose();
        (m.material as Material).dispose();
      }
    },
    [built],
  );

  return (
    <>
      {built.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}
