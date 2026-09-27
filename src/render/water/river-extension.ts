import type { Vec2 } from '../../core/math/vec2.ts';
import { extendPolyline } from '../../core/worldgen/geometry.ts';

/** The prolonged course meanders (±20° every 50 m) instead of running dead straight. */
const MEANDER_STEP_M = 50;
const MEANDER_TURN_RAD = (20 * Math.PI) / 180;

function hash01(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Bends the part of `line` beyond `keep` points, deterministically from the anchor point. */
function meanderTail(line: Vec2[], keep: number, fromEnd: boolean): Vec2[] {
  const pts = fromEnd ? line : [...line].reverse();
  const out = pts.slice(0, keep);
  let prev = out[out.length - 1] as Vec2;
  const before = (out[out.length - 2] ?? prev) as Vec2;
  let heading = Math.atan2(prev.z - before.z, prev.x - before.x);
  let travelled = 0;
  for (let k = keep; k < pts.length; k++) {
    const p = pts[k] as Vec2;
    const step = Math.hypot(p.x - prev.x, p.z - prev.z);
    travelled += step;
    if (travelled >= MEANDER_STEP_M) {
      travelled = 0;
      heading += (hash01(prev.x, prev.z) * 2 - 1) * MEANDER_TURN_RAD;
    }
    const next = { x: prev.x + Math.cos(heading) * step, z: prev.z + Math.sin(heading) * step };
    out.push(next);
    prev = next;
  }
  return fromEnd ? out : out.reverse();
}

/** Rivers continue this far past their authored ends, into the decorative landscape ring. */
export const RIVER_EXTENSION_M = 250;
const RIVER_EXTENSION_STEP_M = 25;

/** The centreline both the water ribbon and the ring's river bed follow. */
export function extendedRiver(centerline: readonly Vec2[]): Vec2[] {
  const extended = extendPolyline(centerline, RIVER_EXTENSION_M, RIVER_EXTENSION_STEP_M);
  const added = Math.round((extended.length - centerline.length) / 2);
  if (added <= 0) return extended;
  // Bend the tail, then the head (kept: the original points plus the head extension).
  const tail = meanderTail(extended, extended.length - added, true);
  return meanderTail(tail, tail.length - added, false);
}
