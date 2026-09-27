import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { Color, DoubleSide, Mesh } from 'three';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { HouseSite } from '../../core/worldgen/types.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';
import { buildHouses, PROCEDURAL_MATERIAL } from './houses.ts';
import { extractKit } from './kit.ts';

export const VILLAGE_KIT_URL = '/assets/kits/village-kit.glb';
const HOUSE_HEIGHT_M = 8;
const GLASS_COLOR = '#3b4b57';
/** Kit textures that break the saturation rule (STYLE_BIBLE §2) are toned down at load. */
const KIT_ALBEDO_GRADE: Readonly<Record<string, { saturation: number; value: number }>> = {
  MI_RoundTiles: { saturation: 0.6, value: 0.92 },
  MI_Brick: { saturation: 0.75, value: 0.95 },
};
/** Every other kit texture (thatch, plaster, timber): stays under the allegiance saturations. */
const KIT_DEFAULT_GRADE = { saturation: 0.85, value: 1 };

export function Buildings({ houses, terrain }: { readonly houses: readonly HouseSite[]; readonly terrain?: TerrainData }) {
  const gltf = useGLTF(VILLAGE_KIT_URL, false, true);
  const meshes = useMemo(() => {
    const kit = extractKit(gltf.scene);
    const geometries = buildHouses(houses, kit, terrain);
    const out: Mesh[] = [];
    for (const [key, geometry] of [...geometries.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const glass = key.toLowerCase().includes('glass');
      const grade = KIT_ALBEDO_GRADE[key] ?? (key === PROCEDURAL_MATERIAL ? undefined : KIT_DEFAULT_GRADE);
      const material: PaintedMaterial = createPaintedMaterial({
        ...(grade ? { albedoSaturation: grade.saturation, albedoValue: grade.value } : {}),
        name: `House:${key}`,
        map: key === PROCEDURAL_MATERIAL ? null : (kit.textures.get(key) ?? null),
        color: glass ? new Color(GLASS_COLOR) : '#ffffff',
        vertexColors: true,
        vertexData: true,
        heightM: HOUSE_HEIGHT_M,
        gradientBase: 0.74,
        groundAOHeightM: 1.0,
        // The kit is authored double-sided (thin walls, roof undersides seen from the eaves).
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.name = `Houses:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.push(mesh);
    }
    return out;
  }, [gltf, houses, terrain]);

  useEffect(
    () => () => {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as PaintedMaterial).dispose();
      }
    },
    [meshes],
  );

  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}

useGLTF.preload(VILLAGE_KIT_URL, false, true);
