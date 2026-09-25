/**
 * Instanced vegetation: one InstancedMesh per (species, variant), all sharing the painted
 * pipeline. Instances are anchored slightly into the ground (no floating trunks) and carry a
 * per-instance colour jitter so no two trees read identical.
 */
import { useEffect, useMemo } from 'react';
import { Color, DoubleSide, FrontSide, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { TREE_SPECIES, type TreeInstance, type TreeSpecies } from '../../core/worldgen/types.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';
import { buildTreeGeometry, SPECIES_STYLE, TREE_VARIANTS } from './tree-geometry.ts';

const SINK_M = 0.12;
const TINT_WARM = new Color('#e8d27a');
const TINT_COOL = new Color('#7fa39a');
const TINT_AMOUNT = 0.14;
const UP = new Vector3(0, 1, 0);

interface Built {
  readonly meshes: InstancedMesh[];
  readonly geometries: BufferGeometry[];
  readonly materials: PaintedMaterial[];
}

function buildVegetation(trees: readonly TreeInstance[], terrain: TerrainData): Built {
  const buckets = new Map<string, TreeInstance[]>();
  const pickRng = Rng.create('vegetation-variants');
  for (const tree of trees) {
    const key = `${tree.species}:${pickRng.int(0, TREE_VARIANTS - 1)}`;
    const list = buckets.get(key) ?? [];
    list.push(tree);
    buckets.set(key, list);
  }

  const materials = new Map<TreeSpecies, PaintedMaterial>();
  for (const species of TREE_SPECIES) {
    const style = SPECIES_STYLE[species];
    materials.set(
      species,
      createPaintedMaterial({
        name: `Veg:${species}`,
        vertexColors: true,
        heightM: style.heightM,
        windSwayM: style.windSwayM,
        gradientBase: 0.78,
        groundAO: 0.25,
        side: species === 'fern' ? DoubleSide : FrontSide,
        keepNormalOnBackFaces: species === 'fern',
      }),
    );
  }

  const meshes: InstancedMesh[] = [];
  const geometries: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const c = new Color();
  for (const [key, list] of [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [species, variant] = key.split(':') as [TreeSpecies, string];
    const geometry = buildTreeGeometry(species, Number(variant));
    geometries.push(geometry);
    const material = materials.get(species) as PaintedMaterial;
    const mesh = new InstancedMesh(geometry, material, list.length);
    mesh.name = `Veg:${key}`;
    // Small plants do not cast into the sun's shadow map: invisible difference, fewer draw calls.
    mesh.castShadow = species !== 'fern' && species !== 'bush';
    mesh.receiveShadow = true;
    list.forEach((tree, i) => {
      p.set(tree.position.x, sampleHeight(terrain, tree.position.x, tree.position.z) - SINK_M * tree.scale, tree.position.z);
      q.setFromAxisAngle(UP, tree.rotationTurns * 2 * Math.PI);
      s.setScalar(tree.scale);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      c.setRGB(1, 1, 1).lerp(tree.tint >= 0 ? TINT_WARM : TINT_COOL, Math.abs(tree.tint) * TINT_AMOUNT);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return { meshes, geometries, materials: [...materials.values()] };
}

export function Vegetation({ trees, terrain }: { readonly trees: readonly TreeInstance[]; readonly terrain: TerrainData }) {
  const built = useMemo(() => buildVegetation(trees, terrain), [trees, terrain]);
  useEffect(
    () => () => {
      built.geometries.forEach((g) => g.dispose());
      built.materials.forEach((mat) => mat.dispose());
      built.meshes.forEach((mesh) => mesh.dispose());
    },
    [built],
  );
  return (
    <>
      {built.meshes.map((mesh) => (
        <primitive key={mesh.name} object={mesh} />
      ))}
    </>
  );
}
