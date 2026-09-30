/**
 * Castle decks (J4): wall-walks and tower tops become walkable Rampart cells raised to the
 * wall-walk height, reached from the courtyard by stairs along the inner face of the longer wall
 * segments. The result is a per-cell deck elevation for the navigation grid (NavGrid.deck) and
 * the stairs for the renderer. Towers are crossed at the wall-walk level (inner doors).
 */
import type { Vec2 } from '../math/vec2.ts';
import { TerrainLayer } from '../rules/types.ts';
import { cellCenterHeight, type TerrainData } from '../terrain-data/terrain-data.ts';
import type { CastlePlan } from './castle.ts';
import { paintAlongPolyline, paintDisc } from './stamps.ts';
import type { StairSite } from './types.ts';

/** Stairs: count per castle, run length and width (m), clearance from the wall's inner face. */
export const STAIRS = { count: 3, lengthM: 11, widthM: 1.8, clearanceM: 0.1, minSegmentM: 18 } as const;

export interface CastleDecks {
  readonly deck: Float32Array;
  readonly stairs: readonly StairSite[];
}

function inward(a: Vec2, b: Vec2, center: Vec2): Vec2 {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const n = { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  return n.x * (center.x - mid.x) + n.z * (center.z - mid.z) >= 0 ? n : { x: -n.x, z: -n.z };
}

/** Paints ramparts and stairs into \`t\` and returns their deck elevations. */
export function stampCastleDecks(t: TerrainData, castle: CastlePlan, center: Vec2): CastleDecks {
  const deck = new Float32Array(t.width * t.depth);
  const main = castle.walls[0];
  if (!main) return { deck, stairs: [] };
  const walkTop = main.baseHeightM + main.heightM;
  for (const w of castle.walls) paintAlongPolyline(t, w.points, w.thicknessM / 2, TerrainLayer.Rampart);
  for (const tower of castle.towers) paintDisc(t, tower.center, tower.radiusM, TerrainLayer.Rampart);
  for (let i = 0; i < t.layers.length; i++) {
    if (t.layers[i] !== TerrainLayer.Rampart) continue;
    const cx = i % t.width;
    const cz = Math.floor(i / t.width);
    deck[i] = Math.max(0, walkTop - cellCenterHeight(t, cx, cz));
  }

  // Stairs on evenly spread segments long enough to hold them, running up along the inner face.
  const segments: { a: Vec2; b: Vec2; len: number }[] = [];
  for (const w of castle.walls) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i] as Vec2;
      const b = w.points[i + 1] as Vec2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len >= STAIRS.minSegmentM) segments.push({ a, b, len });
    }
  }
  const stairs: StairSite[] = [];
  const count = Math.min(STAIRS.count, segments.length);
  for (let k = 0; k < count; k++) {
    const seg = segments[Math.floor(((k + 0.5) * segments.length) / count)] as { a: Vec2; b: Vec2; len: number };
    const dir = { x: (seg.b.x - seg.a.x) / seg.len, z: (seg.b.z - seg.a.z) / seg.len };
    const n = inward(seg.a, seg.b, center);
    const offset = main.thicknessM / 2 + STAIRS.clearanceM + STAIRS.widthM / 2;
    const mid = { x: (seg.a.x + seg.b.x) / 2 + n.x * offset, z: (seg.a.z + seg.b.z) / 2 + n.z * offset };
    const bottom = { x: mid.x - (dir.x * STAIRS.lengthM) / 2, z: mid.z - (dir.z * STAIRS.lengthM) / 2 };
    const top = { x: mid.x + (dir.x * STAIRS.lengthM) / 2, z: mid.z + (dir.z * STAIRS.lengthM) / 2 };
    const bottomHeightM = main.baseHeightM;
    let painted = 0;
    const minX = Math.floor(Math.min(bottom.x, top.x) - STAIRS.widthM);
    const maxX = Math.ceil(Math.max(bottom.x, top.x) + STAIRS.widthM);
    const minZ = Math.floor(Math.min(bottom.z, top.z) - STAIRS.widthM);
    const maxZ = Math.ceil(Math.max(bottom.z, top.z) + STAIRS.widthM);
    for (let cz = Math.max(0, minZ); cz <= Math.min(t.depth - 1, maxZ); cz++) {
      for (let cx = Math.max(0, minX); cx <= Math.min(t.width - 1, maxX); cx++) {
        const px = cx + 0.5 - bottom.x;
        const pz = cz + 0.5 - bottom.z;
        const along = px * dir.x + pz * dir.z;
        const across = px * n.x + pz * n.z;
        if (along < 0 || along > STAIRS.lengthM || Math.abs(across) > STAIRS.widthM / 2) continue;
        const i = cz * t.width + cx;
        if (t.layers[i] === TerrainLayer.Rampart) continue;
        t.layers[i] = TerrainLayer.Stair;
        const rise = bottomHeightM + (walkTop - bottomHeightM) * (along / STAIRS.lengthM);
        deck[i] = Math.max(0, rise - cellCenterHeight(t, cx, cz));
        painted++;
      }
    }
    if (painted > 0) stairs.push({ id: `stair-${k}`, bottom, top, widthM: STAIRS.widthM, bottomHeightM, topHeightM: walkTop });
  }
  return { deck, stairs };
}
