/**
 * Which meshes the sun's shadow pass draws, beyond three's test of each cascade's frustum (ADR-055).
 * - Shadow-only meshes, never drawn in a view: the terrain that casts the hills' shadows (finer in
 *   the near cascade than in the far one), the castle's band standing in for its merlons. The
 *   view's frustum test turns them away (no draw call, no triangle sent); the shadow pass tests
 *   each cascade's own frustum, which the sun registers here, nearest first. (three r186 filters
 *   shadow casters by the view camera's layers, so a layer cannot do it.)
 * - Small casters (the men, their shields): drawn into the maps only where their short shadow can
 *   fall in the view, which the sun also sets here each frame. The cascades are wide boxes stretched
 *   towards the sun: they held every man of the map, a draw each, for shadows no one would see.
 */
import { Frustum, Matrix4, Sphere, type Mesh } from 'three';

/** The frustums of the sun's cascades, nearest first (a plain array: tested for every caster, every shadow pass). */
const sunFrusta: Frustum[] = [];

/** Called by the sun: its cascades' frustums (nearest first) are where shadow-only meshes are drawn. Returns the undo. */
export function registerSunFrusta(frusta: readonly Frustum[]): () => void {
  sunFrusta.push(...frusta);
  return () => {
    for (const f of frusta) {
      const i = sunFrusta.indexOf(f);
      if (i >= 0) sunFrusta.splice(i, 1);
    }
  };
}

/** The view's frustum this frame (set by the sun before the shadow pass). */
const viewFrustum = new Frustum();
const viewProjection = new Matrix4();
const reach = new Sphere();

/** Called by the sun each frame, before the shadow pass: the view the small casters' shadows must reach. */
export function setShadowView(camera: { readonly projectionMatrix: Matrix4; readonly matrixWorldInverse: Matrix4 }): void {
  viewFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

/**
 * Makes `mesh` (a small caster) drawn into the sun's maps only when its shadow, at most `reachM`
 * long, can fall in the view. Its own bounds (`boundingSphere` for a skinned mesh's fixed bounds,
 * else its geometry's), as three's frustum test reads them.
 */
export function castShadowNearView(mesh: Mesh, reachM: number): void {
  mesh.intersectsFrustum = (frustum: Frustum) => {
    if (sunFrusta.includes(frustum)) {
      const own = (mesh as { boundingSphere?: Sphere | null }).boundingSphere;
      if (!own && !mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      reach.copy(own ?? (mesh.geometry.boundingSphere as Sphere)).applyMatrix4(mesh.matrixWorld);
      reach.radius += reachM;
      if (!viewFrustum.intersectsSphere(reach)) return false;
    }
    return frustum.intersectsObject(mesh);
  };
}

/** Which of the sun's cascades a shadow-only mesh is drawn into. */
export type SunCascades = 'all' | 'near' | 'far';

/** Makes `mesh` cast the sun's shadow, in `cascades`, without ever being drawn in a view. */
export function castShadowOnly(mesh: Mesh, cascades: SunCascades = 'all'): void {
  mesh.castShadow = true;
  mesh.frustumCulled = true;
  mesh.intersectsFrustum = (frustum: Frustum) => {
    const i = sunFrusta.indexOf(frustum);
    if (i < 0) return false;
    if (cascades === 'near' && i !== 0) return false;
    if (cascades === 'far' && i === 0) return false;
    return frustum.intersectsObject(mesh);
  };
}
