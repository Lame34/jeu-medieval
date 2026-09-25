/** Terrain mesh built straight from the shared heightfield (vertices = heightfield corners). */
import { BufferAttribute, BufferGeometry } from 'three';
import { heightAtCorner, type TerrainData } from '../../core/terrain-data/terrain-data.ts';

export interface TerrainPatch {
  /** First corner (inclusive) and number of cells covered, in corner units. */
  readonly ix0: number;
  readonly iz0: number;
  readonly cellsX: number;
  readonly cellsZ: number;
  /** Corner stride (1 = full resolution, 2 = half…). */
  readonly step: number;
  /** Extra skirt depth (m) hiding cracks between LODs; 0 for none. */
  readonly skirtM: number;
}

export function buildTerrainGeometry(t: TerrainData, patch: TerrainPatch): BufferGeometry {
  const cs = t.cellSize;
  const nx = Math.floor(patch.cellsX / patch.step) + 1;
  const nz = Math.floor(patch.cellsZ / patch.step) + 1;
  const skirt = patch.skirtM > 0;
  const ringVerts = skirt ? 2 * (nx + nz) : 0;
  const positions = new Float32Array((nx * nz + ringVerts) * 3);
  const normals = new Float32Array((nx * nz + ringVerts) * 3);

  const h = (ix: number, iz: number) => heightAtCorner(t, ix, iz);
  let v = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const ix = patch.ix0 + i * patch.step;
      const iz = patch.iz0 + j * patch.step;
      positions[v * 3] = ix * cs;
      positions[v * 3 + 1] = h(ix, iz);
      positions[v * 3 + 2] = iz * cs;
      const dx = (h(ix + 1, iz) - h(ix - 1, iz)) / (2 * cs);
      const dz = (h(ix, iz + 1) - h(ix, iz - 1)) / (2 * cs);
      const len = Math.hypot(dx, 1, dz);
      normals[v * 3] = -dx / len;
      normals[v * 3 + 1] = 1 / len;
      normals[v * 3 + 2] = -dz / len;
      v++;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // Alternate the diagonal to avoid a directional grain in the shading.
      if ((i + j) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  }

  if (skirt) {
    const border: number[] = [];
    for (let i = 0; i < nx; i++) border.push(i);
    for (let j = 1; j < nz; j++) border.push(j * nx + nx - 1);
    for (let i = nx - 2; i >= 0; i--) border.push((nz - 1) * nx + i);
    for (let j = nz - 2; j > 0; j--) border.push(j * nx);
    const base = nx * nz;
    border.forEach((src, k) => {
      const dst = base + k;
      positions[dst * 3] = positions[src * 3] as number;
      positions[dst * 3 + 1] = (positions[src * 3 + 1] as number) - patch.skirtM;
      positions[dst * 3 + 2] = positions[src * 3 + 2] as number;
      normals.set(normals.subarray(src * 3, src * 3 + 3), dst * 3);
    });
    for (let k = 0; k < border.length; k++) {
      const a = border[k] as number;
      const b = border[(k + 1) % border.length] as number;
      const a2 = base + k;
      const b2 = base + ((k + 1) % border.length);
      indices.push(a, b, a2, b, b2, a2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'Terrain';
  return geometry;
}
