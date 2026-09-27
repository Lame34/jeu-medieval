/**
 * Level-of-detail batch (brief §7): one BatchedMesh (one multi-draw call, plus one in the
 * shadow pass) holding detailed and light geometries; each instance swaps between them with
 * the camera distance (hysteresis), or is hidden beyond the distance when there is no light
 * geometry (ground clutter).
 *
 * Culling is coarse and happens only when the owner re-evaluates (the camera moved or turned):
 * instances outside the camera frustum grown by a margin are hidden. three then skips its own
 * per-frame, per-instance culling (and the draw-list rebuild) entirely — that loop cost ~1 ms a
 * frame on the 500 m map, ×4 under CPU throttling. The margin keeps off-screen trees casting
 * their long evening shadows into view.
 */
import { BatchedMesh, Frustum, Matrix4, Quaternion, Sphere, Vector3, type BufferGeometry, type Camera, type Color } from 'three';
import type { PaintedMaterial } from '../materials/painted-material.ts';

const HYSTERESIS_M = 8;
/** Frustum growth (m) for the coarse culling: camera drift between passes and shadow casters. */
const CULL_MARGIN_M = 15;

export interface LodBatchSpec {
  readonly name: string;
  readonly material: PaintedMaterial;
  /** Detailed geometries (instances pick one by index). */
  readonly near: readonly BufferGeometry[];
  /** Light geometries (instance near index modulo their count); empty: hide beyond the distance. */
  readonly far: readonly BufferGeometry[];
  /** Camera distance (m) under which the detailed geometry is used. */
  readonly detailDistanceM: number;
  readonly castShadow: boolean;
}

export interface LodBatchInstance {
  readonly matrix: Matrix4;
  readonly color: Color;
  /** Index into `near`. */
  readonly variant: number;
}

export interface LodBatch {
  readonly mesh: BatchedMesh;
  /** Swaps levels of detail and culls for a camera (call when the camera moved or turned). */
  update(camera: Camera): void;
  dispose(): void;
}

const frustum = new Frustum();
const viewProjection = new Matrix4();
const sphere = new Sphere();

export function createLodBatch(spec: LodBatchSpec, instances: readonly LodBatchInstance[]): LodBatch {
  const geometries = [...spec.near, ...spec.far];
  const vertices = geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
  const mesh = new BatchedMesh(Math.max(1, instances.length), vertices, 0, spec.material);
  mesh.name = spec.name;
  mesh.sortObjects = false;
  mesh.perObjectFrustumCulled = false;
  mesh.castShadow = spec.castShadow;
  mesh.receiveShadow = true;
  const nearIds = spec.near.map((g) => mesh.addGeometry(g));
  const farIds = spec.far.map((g) => mesh.addGeometry(g));
  const hideFar = farIds.length === 0;
  const geometryRadius = Math.max(
    ...geometries.map((g) => {
      if (!g.boundingSphere) g.computeBoundingSphere();
      return (g.boundingSphere?.radius ?? 1) + (g.boundingSphere?.center.length() ?? 0);
    }),
  );

  const count = instances.length;
  const positions = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const nearOf = new Int32Array(count);
  const farOf = new Int32Array(count);
  const scale = new Vector3();
  instances.forEach((inst, i) => {
    nearOf[i] = nearIds[inst.variant % nearIds.length] as number;
    farOf[i] = hideFar ? (nearOf[i] as number) : (farIds[inst.variant % farIds.length] as number);
    const id = mesh.addInstance(farOf[i] as number);
    mesh.setMatrixAt(id, inst.matrix);
    mesh.setColorAt(id, inst.color);
    mesh.setVisibleAt(id, false);
    const e = inst.matrix.elements;
    positions[i * 3] = e[12] as number;
    positions[i * 3 + 1] = e[13] as number;
    positions[i * 3 + 2] = e[14] as number;
    scale.setFromMatrixScale(inst.matrix);
    radii[i] = geometryRadius * Math.max(scale.x, scale.y, scale.z);
  });
  const detailed = new Uint8Array(count);
  const visible = new Uint8Array(count);
  const enter = (spec.detailDistanceM - HYSTERESIS_M) ** 2;
  const leave = (spec.detailDistanceM + HYSTERESIS_M) ** 2;

  return {
    mesh,
    update(camera) {
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem, camera.reversedDepth);
      const c = camera.position;
      for (let i = 0; i < count; i++) {
        const x = positions[i * 3] as number;
        const y = positions[i * 3 + 1] as number;
        const z = positions[i * 3 + 2] as number;
        const d2 = (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2;
        const was = detailed[i] === 1;
        const near = was ? d2 < leave : d2 < enter;
        if (near !== was) {
          detailed[i] = near ? 1 : 0;
          if (!hideFar) mesh.setGeometryIdAt(i, near ? (nearOf[i] as number) : (farOf[i] as number));
        }
        sphere.center.set(x, y, z);
        sphere.radius = (radii[i] as number) + CULL_MARGIN_M;
        const show = (near || !hideFar) && frustum.intersectsSphere(sphere);
        if (show !== (visible[i] === 1)) {
          visible[i] = show ? 1 : 0;
          mesh.setVisibleAt(i, show);
        }
      }
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      spec.material.dispose();
      mesh.dispose();
    },
  };
}

/** Camera pose at the last level-of-detail pass; `moved` accepts a new pass when it drifted. */
export class CameraTrigger {
  private readonly position = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly quaternion = new Quaternion();
  private readonly stepM: number;
  private readonly turnRad: number;

  constructor(stepM = 4, turnDeg = 2) {
    this.stepM = stepM;
    this.turnRad = (turnDeg * Math.PI) / 180;
  }

  moved(camera: Camera): boolean {
    if (camera.position.distanceToSquared(this.position) < this.stepM ** 2 && camera.quaternion.angleTo(this.quaternion) < this.turnRad) return false;
    this.position.copy(camera.position);
    this.quaternion.copy(camera.quaternion);
    return true;
  }
}
