import { useEffect, useMemo } from 'react';
import { Mesh, type Texture } from 'three';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { buildTerrainGeometry } from './terrain-geometry.ts';
import type { SeasonPalette } from '../materials/season-palette.ts';
import { createTerrainMaterial } from './terrain-material.ts';

/** Single-mesh terrain (look-dev scale). The battle map uses chunked LOD terrain instead. */
export function Terrain({ terrain, splat, season }: { readonly terrain: TerrainData; readonly splat: Texture; readonly season: SeasonPalette }) {
  const mesh = useMemo(() => {
    const geometry = buildTerrainGeometry(terrain, { ix0: 0, iz0: 0, cellsX: terrain.width, cellsZ: terrain.depth, step: 1, skirtM: 0 });
    let sum = 0;
    for (const h of terrain.heights) sum += h;
    const material = createTerrainMaterial(splat, { x: terrain.width * terrain.cellSize, z: terrain.depth * terrain.cellSize }, sum / terrain.heights.length, undefined, false, season);
    const m = new Mesh(geometry, material);
    m.receiveShadow = true;
    m.castShadow = true;
    m.name = 'Terrain';
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }, [terrain, splat, season]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    },
    [mesh],
  );

  return <primitive object={mesh} />;
}
