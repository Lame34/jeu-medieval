/**
 * Exact grid traversal of a segment (Amanatides–Woo DDA). Reports every cell whose interior
 * the segment crosses, with the parametric interval [t0, t1] spent inside it, and every grid
 * corner it passes through exactly (so callers can forbid squeezing between two blocked cells).
 */

/** Parametric tolerance for "passes exactly through a corner". */
const CORNER_EPSILON_T = 1e-9;
/** Pieces shorter than this (in t) are treated as touching, not crossing. */
const MIN_PIECE_T = 1e-12;

export interface GridShape {
  readonly width: number;
  readonly depth: number;
  readonly cellSize: number;
}

/** Return false to abort the traversal. */
export type CellVisitor = (cx: number, cz: number, t0: number, t1: number) => boolean;
/** Called when the segment passes exactly through the shared corner of the two side cells. */
export type CornerVisitor = (sideAx: number, sideAz: number, sideBx: number, sideBz: number) => boolean;

/**
 * Traverses from (ax, az) to (bx, bz) in world metres. Returns false if a visitor aborted.
 * Cells outside the grid are still reported: bounds checks belong to the visitor.
 */
export function traverseSegment(
  grid: GridShape,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  visitCell: CellVisitor,
  visitCorner?: CornerVisitor,
): boolean {
  const x0 = ax / grid.cellSize;
  const z0 = az / grid.cellSize;
  const dx = bx / grid.cellSize - x0;
  const dz = bz / grid.cellSize - z0;
  let cx = Math.floor(x0);
  let cz = Math.floor(z0);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (cx + 1 - x0) / dx : stepX < 0 ? (cx - x0) / dx : Infinity;
  let tMaxZ = stepZ > 0 ? (cz + 1 - z0) / dz : stepZ < 0 ? (cz - z0) / dz : Infinity;
  let t = 0;

  for (;;) {
    const tNext = Math.min(tMaxX, tMaxZ, 1);
    if (tNext - t > MIN_PIECE_T && !visitCell(cx, cz, t, tNext)) return false;
    if (tNext >= 1) return true;
    if (Math.abs(tMaxX - tMaxZ) <= CORNER_EPSILON_T) {
      if (visitCorner && t < tNext && !visitCorner(cx + stepX, cz, cx, cz + stepZ)) return false;
      cx += stepX;
      cz += stepZ;
      t = tNext;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      cx += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else {
      cz += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
}
