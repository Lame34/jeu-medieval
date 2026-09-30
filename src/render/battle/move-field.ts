/**
 * The selected unit's movement area, for the terrain shader's two painted contours (brief §9.2):
 * AP cost per cell in a fixed 128 × 128 m window around the unit (R8: 0–254 = cost relative to
 * the unit's AP, 255 = out of reach), allocated once. Shared uniforms: every map terrain material
 * reads them (the decorative ring does not).
 */
import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector2 } from 'three';
import type { MovementArea } from '../../core/battle/movement.ts';
import { IMPASSABLE } from '../../core/nav-grid/nav-grid.ts';

export const MOVE_FIELD_CELLS = 128;
const UNREACHABLE = 255;
const COST_SCALE = 254;

const data = new Uint8Array(MOVE_FIELD_CELLS * MOVE_FIELD_CELLS).fill(UNREACHABLE);
const texture = new DataTexture(data, MOVE_FIELD_CELLS, MOVE_FIELD_CELLS, RedFormat, UnsignedByteType);
texture.magFilter = LinearFilter;
texture.minFilter = LinearFilter;
texture.needsUpdate = true;

export const moveFieldUniforms = {
  uMoveField: { value: texture },
  /** World position (m) of the window's corner and its size. */
  uMoveFieldOrigin: { value: new Vector2(0, 0) },
  uMoveFieldSize: { value: new Vector2(MOVE_FIELD_CELLS, MOVE_FIELD_CELLS) },
  /** Inner contour ("move + act") as a fraction of the outer ("move only") budget. */
  uMoveInner: { value: 0.75 },
  /** 0 = no area shown. */
  uMoveOn: { value: 0 },
};

/** Shows `area` (null hides it). The window is centred on the area's origin cell. */
export function showMoveArea(area: MovementArea | null, gridWidth: number, cellSize: number): void {
  if (!area || area.moveOnlyBudget <= 0) {
    moveFieldUniforms.uMoveOn.value = 0;
    return;
  }
  const { field } = area;
  const ox = (area.field.origin % gridWidth) - MOVE_FIELD_CELLS / 2;
  const oz = Math.floor(area.field.origin / gridWidth) - MOVE_FIELD_CELLS / 2;
  data.fill(UNREACHABLE);
  for (let wz = 0; wz < field.depth; wz++) {
    const tz = field.minCz + wz - oz;
    if (tz < 1 || tz >= MOVE_FIELD_CELLS - 1) continue;
    for (let wx = 0; wx < field.width; wx++) {
      const tx = field.minCx + wx - ox;
      if (tx < 1 || tx >= MOVE_FIELD_CELLS - 1) continue;
      const cost = field.cost[wz * field.width + wx] as number;
      if (cost === IMPASSABLE || cost > area.moveOnlyBudget) continue;
      data[tz * MOVE_FIELD_CELLS + tx] = Math.round((cost / area.moveOnlyBudget) * COST_SCALE);
    }
  }
  texture.needsUpdate = true;
  moveFieldUniforms.uMoveFieldOrigin.value.set(ox * cellSize, oz * cellSize);
  moveFieldUniforms.uMoveFieldSize.value.set(MOVE_FIELD_CELLS * cellSize, MOVE_FIELD_CELLS * cellSize);
  moveFieldUniforms.uMoveInner.value = area.moveAndActBudget / area.moveOnlyBudget;
  moveFieldUniforms.uMoveOn.value = 1;
}
