import { useEffect, useMemo } from 'react';
import { Mesh, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TowerSite, WallRun } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { buildTowerGeometry, buildWallGeometry } from './castle-geometry.ts';
import { createStoneMaterial } from './stone-material.ts';

const TOWER_ROOF_HEIGHT_M = 16;

export function Castle({ walls, towers }: { readonly walls: readonly WallRun[]; readonly towers: readonly TowerSite[] }) {
  const built = useMemo(() => {
    const stoneParts: BufferGeometry[] = walls.map(buildWallGeometry);
    const roofParts: BufferGeometry[] = [];
    for (const tower of towers) {
      const { stone, roof } = buildTowerGeometry(tower);
      stoneParts.push(stone);
      roofParts.push(roof);
    }
    const maxHeight = Math.max(...walls.map((w) => w.heightM), ...towers.map((t) => t.heightM), 1);
    const stoneGeo = mergeGeometries(stoneParts, false);
    stoneParts.forEach((g) => g.dispose());
    const stone = new Mesh(stoneGeo ?? undefined, createStoneMaterial(maxHeight));
    stone.castShadow = true;
    stone.receiveShadow = true;
    stone.name = 'Castle:stone';
    const meshes = [stone];
    if (roofParts.length > 0) {
      const roofGeo = mergeGeometries(roofParts, false);
      roofParts.forEach((g) => g.dispose());
      const roof = new Mesh(roofGeo ?? undefined, createPaintedMaterial({ name: 'Castle:roof', vertexColors: true, vertexData: true, heightM: TOWER_ROOF_HEIGHT_M, gradientBase: 0.6 }));
      roof.castShadow = true;
      roof.receiveShadow = true;
      roof.name = 'Castle:roof';
      meshes.push(roof);
    }
    return meshes;
  }, [walls, towers]);

  useEffect(
    () => () => {
      for (const m of built) {
        m.geometry.dispose();
        (m.material as { dispose(): void }).dispose();
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
