/**
 * Chunked terrain with geometric LOD (brief §7): 128 m chunks, three resolutions chosen by
 * camera distance, skirts hiding the cracks between neighbours of different LOD, frustum
 * culling per chunk. All chunks share the painted terrain material (one program). The chunks
 * cast no shadow: two coarser meshes of the whole map do, one per cascade of the sun — a single
 * draw in each instead of a draw per chunk, and the far cascade's mesh four times lighter
 * (ADR-055).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BackSide, Mesh, MeshBasicMaterial, type BufferGeometry, type Texture } from 'three';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { buildTerrainGeometry } from './terrain-geometry.ts';
import type { SeasonPalette } from '../materials/season-palette.ts';
import { createTerrainMaterial } from './terrain-material.ts';
import { castShadowOnly, type SunCascades } from '../atmosphere/shadow-only.ts';

const CHUNK_CELLS = 128;
/** LOD step (corner stride) and the camera distance up to which it is used. */
const LODS: readonly { readonly step: number; readonly maxDistM: number }[] = [
  { step: 1, maxDistM: 140 },
  { step: 2, maxDistM: 300 },
  { step: 4, maxDistM: Number.POSITIVE_INFINITY },
];
const SKIRT_M = 2.5;
const LOD_HYSTERESIS_M = 12;
/**
 * The shadow casters' corner strides: hills and banks, not single cells, cast the terrain's
 * shadows; in the far cascade, whose texels are several times wider, the hills alone.
 */
const SHADOW_CASTER_STEPS: Readonly<Record<Exclude<SunCascades, 'all'>, number>> = { near: 2, far: 4 };

/**
 * The whole map's terrain drawn only into one cascade of the sun's shadow maps (shadow-only.ts),
 * with the faces turned from the sun, as the chunks' own front-sided material did.
 */
function terrainShadowCaster(terrain: TerrainData, material: MeshBasicMaterial, cascade: Exclude<SunCascades, 'all'>): Mesh {
  const geometry = buildTerrainGeometry(terrain, { ix0: 0, iz0: 0, cellsX: terrain.width, cellsZ: terrain.depth, step: SHADOW_CASTER_STEPS[cascade], skirtM: 0, normals: false });
  const mesh = new Mesh(geometry, material);
  mesh.name = `TerrainShadow:${cascade}`;
  castShadowOnly(mesh, cascade);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

interface Chunk {
  readonly mesh: Mesh;
  readonly lods: readonly BufferGeometry[];
  readonly centerX: number;
  readonly centerZ: number;
  lod: number;
}

export function ChunkedTerrain({ terrain, splat, season }: { readonly terrain: TerrainData; readonly splat: Texture; readonly season: SeasonPalette }) {
  const built = useMemo(() => {
    let sum = 0;
    for (const h of terrain.heights) sum += h;
    const cs = terrain.cellSize;
    const material = createTerrainMaterial(splat, { x: terrain.width * cs, z: terrain.depth * cs }, sum / terrain.heights.length, undefined, false, season);
    const chunks: Chunk[] = [];
    for (let iz0 = 0; iz0 < terrain.depth; iz0 += CHUNK_CELLS) {
      for (let ix0 = 0; ix0 < terrain.width; ix0 += CHUNK_CELLS) {
        const cellsX = Math.min(CHUNK_CELLS, terrain.width - ix0);
        const cellsZ = Math.min(CHUNK_CELLS, terrain.depth - iz0);
        const lods = LODS.map(({ step }) => buildTerrainGeometry(terrain, { ix0, iz0, cellsX, cellsZ, step, skirtM: step > 1 ? SKIRT_M : 0 }));
        const mesh = new Mesh(lods[0], material);
        mesh.name = `TerrainChunk:${ix0},${iz0}`;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        chunks.push({ mesh, lods, centerX: (ix0 + cellsX / 2) * cs, centerZ: (iz0 + cellsZ / 2) * cs, lod: 0 });
      }
    }
    const casterMaterial = new MeshBasicMaterial();
    casterMaterial.shadowSide = BackSide;
    const casters = [terrainShadowCaster(terrain, casterMaterial, 'near'), terrainShadowCaster(terrain, casterMaterial, 'far')];
    return { chunks, material, casters, casterMaterial };
  }, [terrain, splat, season]);

  useEffect(
    () => () => {
      for (const c of built.chunks) c.lods.forEach((g) => g.dispose());
      built.material.dispose();
      for (const c of built.casters) c.geometry.dispose();
      built.casterMaterial.dispose();
    },
    [built],
  );

  useFrame(({ camera }) => {
    for (const chunk of built.chunks) {
      const dx = camera.position.x - chunk.centerX;
      const dz = camera.position.z - chunk.centerZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      // Plain loop: a findIndex closure per chunk per frame was garbage (no allocation in useFrame).
      let lod = LODS.length - 1;
      for (let k = 0; k < LODS.length; k++) {
        if (d < (LODS[k]?.maxDistM ?? 0)) {
          lod = k;
          break;
        }
      }
      // Hysteresis: only switch when clearly inside the new band (no popping back and forth).
      if (lod !== chunk.lod) {
        const boundary = lod > chunk.lod ? (LODS[chunk.lod]?.maxDistM ?? 0) : (LODS[lod]?.maxDistM ?? 0);
        if (Math.abs(d - boundary) < LOD_HYSTERESIS_M) continue;
        chunk.lod = lod;
        chunk.mesh.geometry = chunk.lods[lod] as BufferGeometry;
      }
    }
  });

  return (
    <>
      {built.chunks.map((c) => (
        <primitive key={c.mesh.name} object={c.mesh} />
      ))}
      {built.casters.map((c) => (
        <primitive key={c.name} object={c} />
      ))}
    </>
  );
}
