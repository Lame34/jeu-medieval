/**
 * Batched vegetation (brief §7): one level-of-detail batch per species (see lod-batch.ts)
 * holding every variant, detailed near the camera and light further out; ferns are ground
 * clutter and disappear beyond a radius. Instances are anchored slightly into the ground and
 * carry a colour jitter so no two trees read identical.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, DoubleSide, FrontSide, Matrix4, Quaternion, Vector3 } from 'three';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { TREE_SPECIES, type TreeInstance, type TreeSpecies } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import type { SeasonPalette } from '../materials/season-palette.ts';
import { CameraTrigger, createLodBatch, type LodBatch, type LodBatchInstance } from './lod-batch.ts';
import { buildTreeGeometry, SPECIES_STYLE, TREE_VARIANTS } from './tree-geometry.ts';

const SINK_M = 0.12;
const TINT_WARM = new Color('#e8d27a');
const TINT_COOL = new Color('#7fa39a');
const TINT_AMOUNT = 0.08;
const UP = new Vector3(0, 1, 0);

/** Camera distance (m) under which a tree uses its detailed geometry. */
const DETAIL_DISTANCE_M = 70;
/** Ferns are ground clutter: hidden beyond this camera distance. */
const FERN_DISTANCE_M = 70;
/** Distant trees only need a couple of silhouettes per species. */
const FAR_VARIANTS = 2;

function speciesBatch(species: TreeSpecies, trees: readonly TreeInstance[], terrain: TerrainData, variantOf: (t: TreeInstance) => number, season: SeasonPalette): LodBatch {
  const style = SPECIES_STYLE[species];
  const fern = species === 'fern';
  const material = createPaintedMaterial({
    name: `Veg:${species}`,
    vertexColors: true,
    heightM: style.heightM,
    windSwayM: style.windSwayM,
    gradientBase: 0.78,
    groundAO: 0.25,
    side: fern ? DoubleSide : FrontSide,
    keepNormalOnBackFaces: fern,
    foliage: !fern,
    nearFade: true,
  });
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const instances: LodBatchInstance[] = trees.map((tree) => {
    p.set(tree.position.x, sampleHeight(terrain, tree.position.x, tree.position.z) - SINK_M * tree.scale, tree.position.z);
    q.setFromAxisAngle(UP, tree.rotationTurns * 2 * Math.PI);
    s.setScalar(tree.scale);
    const color = new Color(1, 1, 1).lerp(tree.tint >= 0 ? TINT_WARM : TINT_COOL, Math.abs(tree.tint) * TINT_AMOUNT);
    return { matrix: new Matrix4().compose(p, q, s), color, variant: variantOf(tree) };
  });
  return createLodBatch(
    {
      name: `Veg:${species}`,
      material,
      near: Array.from({ length: TREE_VARIANTS }, (_, v) => buildTreeGeometry(species, v, 0, season)),
      far: fern ? [] : Array.from({ length: FAR_VARIANTS }, (_, v) => buildTreeGeometry(species, v, 1, season)),
      detailDistanceM: fern ? FERN_DISTANCE_M : DETAIL_DISTANCE_M,
      // Bushes cast (they would float otherwise); ferns are too small to matter.
      castShadow: !fern,
    },
    instances,
  );
}

function buildVegetation(trees: readonly TreeInstance[], terrain: TerrainData, season: SeasonPalette): LodBatch[] {
  const pickRng = Rng.create('vegetation-variants');
  const variants = new Map<TreeInstance, number>(trees.map((t) => [t, pickRng.int(0, TREE_VARIANTS - 1)]));
  const variantOf = (t: TreeInstance) => variants.get(t) ?? 0;
  return TREE_SPECIES.map((species) => {
    const list = trees.filter((t) => t.species === species);
    return list.length > 0 ? speciesBatch(species, list, terrain, variantOf, season) : null;
  }).filter((b): b is LodBatch => b !== null);
}

export function Vegetation({ trees, terrain, season }: { readonly trees: readonly TreeInstance[]; readonly terrain: TerrainData; readonly season: SeasonPalette }) {
  const { batches, trigger } = useMemo(() => ({ batches: buildVegetation(trees, terrain, season), trigger: new CameraTrigger() }), [trees, terrain, season]);

  useFrame(({ camera }) => {
    if (!trigger.moved(camera)) return;
    for (const batch of batches) batch.update(camera);
  });

  useEffect(() => () => batches.forEach((b) => b.dispose()), [batches]);
  return (
    <>
      {batches.map((b) => (
        <primitive key={b.mesh.name} object={b.mesh} />
      ))}
    </>
  );
}
