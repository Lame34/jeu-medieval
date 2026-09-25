import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { Color, DoubleSide, Mesh } from 'three';
import type { HouseSite } from '../../core/worldgen/types.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';
import { buildHouses, PROCEDURAL_MATERIAL } from './houses.ts';
import { extractKit } from './kit.ts';

export const VILLAGE_KIT_URL = '/assets/kits/village-kit.glb';
const HOUSE_HEIGHT_M = 8;
const GLASS_COLOR = '#3b4b57';

export function Buildings({ houses }: { readonly houses: readonly HouseSite[] }) {
  const gltf = useGLTF(VILLAGE_KIT_URL, false, true);
  const meshes = useMemo(() => {
    const kit = extractKit(gltf.scene);
    const geometries = buildHouses(houses, kit);
    const out: Mesh[] = [];
    for (const [key, geometry] of [...geometries.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const glass = key.toLowerCase().includes('glass');
      const material: PaintedMaterial = createPaintedMaterial({
        name: `House:${key}`,
        map: key === PROCEDURAL_MATERIAL ? null : (kit.textures.get(key) ?? null),
        color: glass ? new Color(GLASS_COLOR) : '#ffffff',
        vertexColors: true,
        vertexData: true,
        heightM: HOUSE_HEIGHT_M,
        gradientBase: 0.74,
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
  }, [gltf, houses]);

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
