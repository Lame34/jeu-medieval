/**
 * Gatehouse layout shared by the map, the castle structures and the renderer (J4). The passage
 * runs through the gatehouse block (its depth across the wall line); in front of it the moat is
 * crossed by a lifting span hinged at the gatehouse face — raised, it closes the opening — then
 * by a fixed timber bridge on to the outer bank.
 */
import type { Vec2 } from '../math/vec2.ts';
import { TerrainLayer } from '../rules/types.ts';
import { cellCenterHeight, type TerrainData } from '../terrain-data/terrain-data.ts';
import type { GateSite } from './types.ts';

export const GATEHOUSE = {
  /** Depth (m) of the gatehouse block across the wall line. */
  depthM: 3,
  /** The passage cells reach this far beyond the opening on each side (m). */
  passageMarginM: 0.5,
  /** Length (m) of the lifting span from the gatehouse face (taller than the 5 m opening). */
  liftSpanM: 5.5,
  /** The crossing is looked for this far out from the gate (m). */
  reachM: 30,
  /** Ground this far below the sill is spanned (the moat and its sloping banks). */
  dipM: 0.25,
  scanM: 0.5,
} as const;

/** Outward axis of the gate and the axis across it (ground plane). */
export function gateAxes(gate: GateSite): { out: Vec2; across: Vec2 } {
  const a = gate.rotationTurns * 2 * Math.PI;
  return { out: { x: Math.sin(a), z: Math.cos(a) }, across: { x: Math.cos(a), z: -Math.sin(a) } };
}

/** Cells whose centre lies within `alongFrom..alongTo` on the gate axis and `halfWidthM` across it. */
function cellsInGateBox(t: TerrainData, gate: GateSite, alongFrom: number, alongTo: number, halfWidthM: number): number[] {
  const { out, across } = gateAxes(gate);
  const reach = Math.max(Math.abs(alongFrom), Math.abs(alongTo)) + halfWidthM + t.cellSize;
  const out_: number[] = [];
  const minX = Math.max(0, Math.floor(gate.center.x - reach));
  const maxX = Math.min(t.width - 1, Math.ceil(gate.center.x + reach));
  const minZ = Math.max(0, Math.floor(gate.center.z - reach));
  const maxZ = Math.min(t.depth - 1, Math.ceil(gate.center.z + reach));
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const dx = cx + 0.5 - gate.center.x;
      const dz = cz + 0.5 - gate.center.z;
      const along = dx * out.x + dz * out.z;
      const side = dx * across.x + dz * across.z;
      if (along >= alongFrom && along <= alongTo && Math.abs(side) <= halfWidthM) out_.push(cz * t.width + cx);
    }
  }
  return out_;
}

/** The passage through the gatehouse (where the gate and the portcullis stand). */
export function passageCells(t: TerrainData, gate: GateSite): number[] {
  return cellsInGateBox(t, gate, -GATEHOUSE.depthM / 2, GATEHOUSE.depthM / 2, gate.openingM / 2 + GATEHOUSE.passageMarginM);
}

/** Cells under the crossing between `fromM` and `toM` along the gate axis (as wide as the opening). */
export function crossingCells(t: TerrainData, gate: GateSite, fromM: number, toM: number): number[] {
  return cellsInGateBox(t, gate, fromM, toM, gate.openingM / 2);
}

/** Where the crossing ends on the outer bank, along the gate axis (m), or null with no moat in front. */
export function findCrossingEndM(t: TerrainData, gate: GateSite): number | null {
  const { out } = gateAxes(gate);
  const cellAt = (along: number): number | null => {
    const cx = Math.floor(gate.center.x + out.x * along);
    const cz = Math.floor(gate.center.z + out.z * along);
    return cx >= 0 && cz >= 0 && cx < t.width && cz < t.depth ? cz * t.width + cx : null;
  };
  let last = Number.NEGATIVE_INFINITY;
  for (let along = GATEHOUSE.depthM / 2; along <= GATEHOUSE.reachM; along += GATEHOUSE.scanM) {
    const i = cellAt(along);
    if (i !== null && t.layers[i] === TerrainLayer.Moat) last = along;
  }
  if (last === Number.NEGATIVE_INFINITY) return null;
  const belowSill = (along: number) => {
    const i = cellAt(along);
    return i !== null && cellCenterHeight(t, i % t.width, Math.floor(i / t.width)) < gate.baseHeightM - GATEHOUSE.dipM;
  };
  while (last + GATEHOUSE.scanM < GATEHOUSE.reachM && belowSill(last + GATEHOUSE.scanM)) last += GATEHOUSE.scanM;
  return last + t.cellSize;
}

/** Along the gate axis (m): the gatehouse face, where the lifting span is hinged. */
export function liftHingeM(): number {
  return GATEHOUSE.depthM / 2;
}

/** Along the gate axis (m): where the lifting span rests on the fixed bridge when lowered. */
export function liftTipM(): number {
  return GATEHOUSE.depthM / 2 + GATEHOUSE.liftSpanM;
}
