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

/** De-quantises and keeps only position/normal/uv (meshopt + KHR_mesh_quantization input). */
export function toFloatGeometry(source: BufferGeometry): BufferGeometry {
  const out = new BufferGeometry();
  const count = source.getAttribute('position').count;
  for (const name of KEPT_ATTRIBUTES) {
    const attr = source.getAttribute(name);
    const size = name === 'uv' ? 2 : 3;
    const array = new Float32Array(count * size);
    if (attr) {
      for (let i = 0; i < count; i++) {
        array[i * size] = attr.getX(i);
        array[i * size + 1] = attr.getY(i);
        if (size === 3) array[i * size + 2] = attr.getZ(i);
      }
    }
    out.setAttribute(name, new BufferAttribute(array, size));
  }
  const index = source.getIndex();
  if (index) out.setIndex(Array.from(index.array as ArrayLike<number>));
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
