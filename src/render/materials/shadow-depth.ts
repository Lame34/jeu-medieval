/**
 * One shadow depth material per kind of caster. By default three draws every shadow caster with a
 * single shared depth material; when the casters alternate between plain, batched, instanced and
 * skinned meshes, its program changes at each switch, and three recomputes the program parameters
 * and cache key strings every frame (CPU time and garbage). Casters whose depth pass depends on
 * their own material (alpha test, alpha map, displacement, clipping) keep three's per-material
 * variant.
 */
import { BatchedMesh, InstancedMesh, Mesh, MeshDepthMaterial, RGBADepthPacking, type Material, type Object3D } from 'three';

const byKind = new Map<string, MeshDepthMaterial>();

function kindOf(mesh: Mesh): string {
  if (mesh instanceof BatchedMesh) return 'batched';
  if (mesh instanceof InstancedMesh) return 'instanced';
  if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) return 'skinned';
  return 'plain';
}

function needsOwnVariant(material: Material): boolean {
  const m = material as Material & { alphaMap?: unknown; displacementMap?: unknown; clipShadows?: boolean };
  return m.alphaTest > 0 || Boolean(m.alphaMap) || Boolean(m.displacementMap) || Boolean(m.clipShadows) || m.alphaToCoverage;
}

export function assignShadowDepthMaterials(root: Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.castShadow || o.customDepthMaterial) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (materials.some(needsOwnVariant)) return;
    const kind = kindOf(o);
    let depth = byKind.get(kind);
    if (!depth) {
      // Same settings as three's default depth material for PCF shadow maps.
      depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
      depth.name = `ShadowDepth:${kind}`;
      byKind.set(kind, depth);
    }
    o.customDepthMaterial = depth;
  });
}
