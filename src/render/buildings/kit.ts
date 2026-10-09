/**
 * Modular kit access: turns the packed kit GLB (one node per piece) into float geometries in
 * piece-local space, grouped by source material, ready to be transformed and merged.
 */
import { BufferAttribute, BufferGeometry, Mesh, type Material, type Object3D, type Texture } from 'three';

export interface KitPart {
  readonly geometry: BufferGeometry;
  readonly material: string;
}

export interface Kit {
  readonly pieces: ReadonlyMap<string, readonly KitPart[]>;
  /** Albedo texture per kit material name (absent for untextured materials like glass). */
  readonly textures: ReadonlyMap<string, Texture>;
}

const KEPT_ATTRIBUTES = ['position', 'normal', 'uv'] as const;

/**
 * De-quantises, keeps only position/normal/uv (meshopt + KHR_mesh_quantization input) and
 * un-indexes once here: every house places its pieces non-indexed (they are merged), and doing
 * it per placed piece cost a large share of the battle's load.
 */
export function toFloatGeometry(source: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  const index = source.getIndex();
  const count = index ? index.count : source.getAttribute('position').count;
  for (const name of KEPT_ATTRIBUTES) {
    const attr = source.getAttribute(name);
    const size = name === 'uv' ? 2 : 3;
    const array = new Float32Array(count * size);
    if (attr) {
      for (let i = 0; i < count; i++) {
        const v = index ? index.getX(i) : i;
        array[i * size] = attr.getX(v);
        array[i * size + 1] = attr.getY(v);
        if (size === 3) array[i * size + 2] = attr.getZ(v);
      }
    }
    out.setAttribute(name, new BufferAttribute(array, size));
  }
  return out;
}

export function extractKit(root: Object3D): Kit {
  const pieces = new Map<string, KitPart[]>();
  const textures = new Map<string, Texture>();
  root.updateMatrixWorld(true);
  for (const holder of root.children.flatMap((c) => (c.name && c.children.length > 0 && !pieces.has(c.name) ? [c] : []))) {
    const parts: KitPart[] = [];
    const inverseHolder = holder.matrixWorld.clone().invert();
    holder.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const material = obj.material as Material & { map?: Texture | null };
      const geometry = toFloatGeometry(obj.geometry);
      geometry.applyMatrix4(inverseHolder.clone().multiply(obj.matrixWorld));
      parts.push({ geometry, material: material.name });
      if (material.map && !textures.has(material.name)) textures.set(material.name, material.map);
    });
    pieces.set(holder.name, parts);
  }
  return { pieces, textures };
}
