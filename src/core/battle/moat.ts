/**
 * The castle moat as the sappers see it (J4, brief §9.10): its loop is cut into slots of
 * `fillSlotM` along the centreline; filling a slot with fascines lays a causeway across the whole
 * ditch, banks included, a deck just under the sill that every unit (engines too) can cross.
 * Slot geometry is a pure function of the map, computed once per context.
 */
import type { Vec2 } from '../math/vec2.ts';
import { cellCenterHeight } from '../terrain-data/terrain-data.ts';
import { projectOnPolyline, polylineLength } from '../worldgen/geometry.ts';
import type { WorldLayout } from '../worldgen/types.ts';
import type { BattleContext } from './context.ts';

export interface MoatInfo {
  readonly id: string;
  /** Closed loop. */
  readonly centerline: readonly Vec2[];
  readonly widthM: number;
  /** Height (m) of the ground the moat is dug into (the castle plateau). */
  readonly sillM: number;
}

export const FILL_SITE_PREFIX = 'fill:';
/** Ground this far below the sill is part of the ditch (banks included). */
const DITCH_DIP_M = 0.25;
/** The fascine causeway's surface sits this far under the sill (the banks step onto it). */
export const FILL_BELOW_SILL_M = 0.3;

/** Moats of a map, with the plateau height they are dug into (the gates' sill). */
export function moatsOf(layout: WorldLayout): MoatInfo[] {
  const sill = layout.gates.reduce((m, g) => Math.max(m, g.baseHeightM), Number.NEGATIVE_INFINITY);
  return layout.water
    .filter((w) => w.kind === 'moat')
    .map((w) => {
      const first = w.centerline[0];
      const closed = first ? [...w.centerline, first] : [...w.centerline];
      return { id: w.id, centerline: closed, widthM: w.widthM, sillM: Number.isFinite(sill) ? sill : w.levelM };
    });
}

export function fillSiteId(moatId: string, slot: number): string {
  return `${FILL_SITE_PREFIX}${moatId}:${slot}`;
}

const slotCache = new WeakMap<BattleContext, Map<string, number[]>>();

/** Every fill site of the context's moats and its cells. */
function slotsOf(ctx: BattleContext): Map<string, number[]> {
  const cached = slotCache.get(ctx);
  if (cached) return cached;
  const sites = new Map<string, number[]>();
  const t = ctx.baseTerrain;
  const s = ctx.rules.structures;
  for (const moat of ctx.moats) {
    const reach = moat.widthM / 2 + s.fillBankM;
    const slots = Math.max(1, Math.floor(polylineLength(moat.centerline) / s.fillSlotM));
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const p of moat.centerline) {
      minX = Math.min(minX, p.x - reach);
      minZ = Math.min(minZ, p.z - reach);
      maxX = Math.max(maxX, p.x + reach);
      maxZ = Math.max(maxZ, p.z + reach);
    }
    for (let cz = Math.max(0, Math.floor(minZ)); cz <= Math.min(t.depth - 1, Math.ceil(maxZ)); cz++) {
      for (let cx = Math.max(0, Math.floor(minX)); cx <= Math.min(t.width - 1, Math.ceil(maxX)); cx++) {
        if (cellCenterHeight(t, cx, cz) >= moat.sillM - DITCH_DIP_M) continue;
        const proj = projectOnPolyline({ x: cx + 0.5, z: cz + 0.5 }, moat.centerline);
        if (proj.distance > reach) continue;
        const id = fillSiteId(moat.id, Math.min(slots - 1, Math.floor(proj.along / s.fillSlotM)));
        const cells = sites.get(id) ?? [];
        cells.push(cz * t.width + cx);
        sites.set(id, cells);
      }
    }
  }
  slotCache.set(ctx, sites);
  return sites;
}

/** Every fill site of the context's moats, by id, with its cells. */
export function fillSites(ctx: BattleContext): ReadonlyMap<string, readonly number[]> {
  return slotsOf(ctx);
}

/** Cells of a fill site (empty when unknown). */
export function fillCells(ctx: BattleContext, siteId: string): readonly number[] {
  return slotsOf(ctx).get(siteId) ?? [];
}

/** Height (m) of a fill site's causeway. */
export function fillSurfaceM(ctx: BattleContext, siteId: string): number {
  const moat = ctx.moats.find((m) => siteId.startsWith(`${FILL_SITE_PREFIX}${m.id}:`));
  return (moat?.sillM ?? 0) - FILL_BELOW_SILL_M;
}

/** The fill site under `p` (its ditch, banks included), or null away from the moat. */
export function fillSiteAt(ctx: BattleContext, p: Vec2): string | null {
  const s = ctx.rules.structures;
  for (const moat of ctx.moats) {
    const proj = projectOnPolyline(p, moat.centerline);
    if (proj.distance > moat.widthM / 2 + s.fillBankM) continue;
    const slots = Math.max(1, Math.floor(polylineLength(moat.centerline) / s.fillSlotM));
    const id = fillSiteId(moat.id, Math.min(slots - 1, Math.floor(proj.along / s.fillSlotM)));
    return slotsOf(ctx).has(id) ? id : null;
  }
  return null;
}
