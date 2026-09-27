/**
 * Level-of-detail batch (brief §7): one BatchedMesh (one multi-draw call, plus one in the
 * shadow pass) holding detailed and light geometries; each instance swaps between them with
 * the camera distance (hysteresis, re-evaluated only when the camera has moved), or is hidden
 * beyond the distance when there is no light geometry (ground clutter). Per-instance frustum
 * culling; no depth sorting (opaque: sorting would only cost CPU).
 */
import { BatchedMesh, type BufferGeometry, type Color, type Matrix4, type Vector3 } from 'three';
import type { PaintedMaterial } from '../materials/painted-material.ts';

const HYSTERESIS_M = 8;

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
  /** Swaps levels of detail for a camera position. */
  update(camera: Vector3): void;
  dispose(): void;
}

export function createLodBatch(spec: LodBatchSpec, instances: readonly LodBatchInstance[]): LodBatch {
  const geometries = [...spec.near, ...spec.far];
  const vertices = geometries.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
  const mesh = new BatchedMesh(Math.max(1, instances.length), vertices, 0, spec.material);
  mesh.name = spec.name;
  mesh.sortObjects = false;
  mesh.perObjectFrustumCulled = true;
  mesh.castShadow = spec.castShadow;
  mesh.receiveShadow = true;
  const nearIds = spec.near.map((g) => mesh.addGeometry(g));
  const farIds = spec.far.map((g) => mesh.addGeometry(g));
  const hideFar = farIds.length === 0;

  const count = instances.length;
  const positions = new Float32Array(count * 3);
  const nearOf = new Int32Array(count);
  const farOf = new Int32Array(count);
  instances.forEach((inst, i) => {
    nearOf[i] = nearIds[inst.variant % nearIds.length] as number;
    farOf[i] = hideFar ? (nearOf[i] as number) : (farIds[inst.variant % farIds.length] as number);
    const id = mesh.addInstance(farOf[i] as number);
    mesh.setMatrixAt(id, inst.matrix);
    mesh.setColorAt(id, inst.color);
    if (hideFar) mesh.setVisibleAt(id, false);
    const e = inst.matrix.elements;
    positions[i * 3] = e[12] as number;
    positions[i * 3 + 1] = e[13] as number;
    positions[i * 3 + 2] = e[14] as number;
  });
  const detailed = new Uint8Array(count);
  const enter = (spec.detailDistanceM - HYSTERESIS_M) ** 2;
  const leave = (spec.detailDistanceM + HYSTERESIS_M) ** 2;

  return {
    mesh,
    update(camera) {
      for (let i = 0; i < count; i++) {
        const dx = (positions[i * 3] as number) - camera.x;
        const dy = (positions[i * 3 + 1] as number) - camera.y;
        const dz = (positions[i * 3 + 2] as number) - camera.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const was = detailed[i] === 1;
        const now = was ? d2 < leave : d2 < enter;
        if (now === was) continue;
        detailed[i] = now ? 1 : 0;
        if (hideFar) mesh.setVisibleAt(i, now);
        else mesh.setGeometryIdAt(i, now ? (nearOf[i] as number) : (farOf[i] as number));
      }
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      spec.material.dispose();
      mesh.dispose();
    },
  };
}
