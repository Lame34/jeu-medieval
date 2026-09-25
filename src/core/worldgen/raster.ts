/** Per-cell boolean masks for world generation (exclusion zones), stamped with bounded loops. */
import type { Vec2 } from '../math/vec2.ts';
import { pointInPolygon, projectOnPolyline } from './geometry.ts';
import { boundsOf, type Bounds2 } from './stamps.ts';

export class CellMask {
  readonly data: Uint8Array;
  readonly width: number;
  readonly depth: number;
  readonly cellSize: number;

  constructor(width: number, depth: number, cellSize = 1) {
    this.width = width;
    this.depth = depth;
    this.cellSize = cellSize;
    this.data = new Uint8Array(width * depth);
  }

  get(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.width || cz >= this.depth) return true;
    return this.data[cz * this.width + cx] === 1;
  }

  at(p: Vec2): boolean {
    return this.get(Math.floor(p.x / this.cellSize), Math.floor(p.z / this.cellSize));
  }

  private stamp(bounds: Bounds2, test: (c: Vec2) => boolean): void {
    const cs = this.cellSize;
    const cx0 = Math.max(0, Math.floor(bounds.minX / cs));
    const cz0 = Math.max(0, Math.floor(bounds.minZ / cs));
    const cx1 = Math.min(this.width - 1, Math.ceil(bounds.maxX / cs));
    const cz1 = Math.min(this.depth - 1, Math.ceil(bounds.maxZ / cs));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (test({ x: (cx + 0.5) * cs, z: (cz + 0.5) * cs })) this.data[cz * this.width + cx] = 1;
      }
    }
  }

  markPolyline(line: readonly Vec2[], radiusM: number): void {
    this.stamp(boundsOf(line, radiusM), (c) => projectOnPolyline(c, line).distance <= radiusM);
  }

  markDisc(center: Vec2, radiusM: number): void {
    this.stamp(boundsOf([center], radiusM), (c) => Math.hypot(c.x - center.x, c.z - center.z) <= radiusM);
  }

  markPolygon(polygon: readonly Vec2[], marginM = 0): void {
    const closed = [...polygon, polygon[0] as Vec2];
    this.stamp(boundsOf(polygon, marginM), (c) => pointInPolygon(c, polygon) || (marginM > 0 && projectOnPolyline(c, closed).distance <= marginM));
  }

  markRect(bounds: Bounds2): void {
    this.stamp(bounds, () => true);
  }
}
