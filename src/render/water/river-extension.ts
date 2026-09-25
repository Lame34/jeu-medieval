import type { Vec2 } from '../../core/math/vec2.ts';
import { extendPolyline } from '../../core/worldgen/geometry.ts';

/** Rivers continue this far past their authored ends, into the decorative landscape ring. */
export const RIVER_EXTENSION_M = 250;
const RIVER_EXTENSION_STEP_M = 25;

/** The centreline both the water ribbon and the ring's river bed follow. */
export function extendedRiver(centerline: readonly Vec2[]): Vec2[] {
  return extendPolyline(centerline, RIVER_EXTENSION_M, RIVER_EXTENSION_STEP_M);
}
