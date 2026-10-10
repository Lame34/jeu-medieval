/**
 * The scouts' plan on the council's table: the battle's real map around the castle, in sepia ink
 * with its relief shaded, the walls inked, both armies marked — and what the chosen plan changes:
 * the defenders it takes away (crossed out), the men it brings (ringed in gold), the structures
 * it weakens (in red), the causeway already laid (hatched).
 */
import { useEffect, useRef } from 'react';
import type { BattleContext } from '../../core/battle/context.ts';
import { fillCells } from '../../core/battle/moat.ts';
import type { Scenario } from '../../core/battle/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import { TERRAIN_LAYER_KEYS, type TerrainLayerKey } from '../../core/rules/types.ts';
import { cellCenterHeight } from '../../core/terrain-data/terrain-data.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';

/** The plan is drawn for a 360 px sheet at twice that detail, then shown as large as the screen allows. */
const SHEET_PX = 360;
const DETAIL = 2;
/** The margin (m) kept around the castle and the armies; the ring round a change (sheet px). */
const MARGIN_M = 22;
const CHANGE_RING_PX = 16;
/** Relief shading: brightness per metre of slope across a cell, and its bounds. */
const SHADE_PER_M = 0.18;
const SHADE_RANGE = [0.72, 1.12] as const;

const SEPIA: Readonly<Record<TerrainLayerKey, string>> = {
  Plain: '#e6d6ab',
  Road: '#cdb07c',
  Field: '#dcc386',
  Forest: '#b4b47e',
  Mud: '#bea57c',
  Ford: '#b3c3b4',
  River: '#9fb6b3',
  Moat: '#93aaa3',
  Rock: '#c4b79c',
  Building: '#93604a',
  Wall: '#6d5f50',
  Bridge: '#8f6d46',
  Rubble: '#ab9f8a',
  Hedge: '#98a06a',
  DryStoneWall: '#a5997f',
  Rampart: '#bcae94',
  Stair: '#bcae94',
  Fascine: '#9a7a4e',
};
const INK = '#3a2a1a';
const OURS = '#1f4fc4';
const THEIRS = '#b3141e';
const GOLD = '#c9a13b';

export interface PlanMarks {
  /** The battle as the plan leaves it. */
  readonly scenario: Scenario;
  /** Defenders the plan takes away, men it brings. */
  readonly removed: readonly Vec2[];
  readonly added: readonly string[];
}

function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** The square of ground the plan shows: the castle and every unit, with a margin. */
function frameOf(layout: WorldLayout, units: readonly Vec2[]): { x: number; z: number; size: number } {
  const pts: Vec2[] = [...layout.walls.flatMap((w) => w.points), ...units];
  const minX = Math.min(...pts.map((p) => p.x)) - MARGIN_M;
  const maxX = Math.max(...pts.map((p) => p.x)) + MARGIN_M;
  const minZ = Math.min(...pts.map((p) => p.z)) - MARGIN_M;
  const maxZ = Math.max(...pts.map((p) => p.z)) + MARGIN_M;
  const size = Math.max(maxX - minX, maxZ - minZ);
  return { x: (minX + maxX) / 2 - size / 2, z: (minZ + maxZ) / 2 - size / 2, size };
}

export function ScoutPlan({ layout, ctx, base, marks }: { readonly layout: WorldLayout; readonly ctx: BattleContext; readonly base: Scenario; readonly marks: PlanMarks | null }) {
  const ground = useRef<HTMLCanvasElement | null>(null);
  const ink = useRef<HTMLCanvasElement | null>(null);
  const k = DETAIL;
  const px = SHEET_PX * DETAIL;
  const frame = frameOf(layout, base.units.map((u) => u.position));
  const scale = px / frame.size;
  const toPx = (p: Vec2) => ({ x: (p.x - frame.x) * scale, y: (p.z - frame.z) * scale });

  // The ground, once per map: sepia layers, shaded relief, inked walls and towers.
  useEffect(() => {
    const c = ground.current?.getContext('2d');
    if (!c) return;
    const t = layout.terrain;
    const img = c.createImageData(px, px);
    const rgb = TERRAIN_LAYER_KEYS.map((k) => hexRgb(SEPIA[k]));
    for (let py = 0; py < px; py++) {
      for (let qx = 0; qx < px; qx++) {
        const x = Math.floor(frame.x + (qx + 0.5) / scale);
        const z = Math.floor(frame.z + (py + 0.5) / scale);
        const i = (py * px + qx) * 4;
        if (x < 1 || z < 1 || x >= t.width - 1 || z >= t.depth - 1) {
          img.data.set([226, 208, 166, 255], i);
          continue;
        }
        const c3 = rgb[t.layers[z * t.width + x] as number] ?? [0, 0, 0];
        const slope = cellCenterHeight(t, x + 1, z) - cellCenterHeight(t, x - 1, z) + (cellCenterHeight(t, x, z + 1) - cellCenterHeight(t, x, z - 1)) * 0.5;
        const shade = Math.max(SHADE_RANGE[0], Math.min(SHADE_RANGE[1], 1 - slope * SHADE_PER_M));
        // Ink speckles in the woods, furrows in the fields.
        const layer = TERRAIN_LAYER_KEYS[t.layers[z * t.width + x] as number];
        const speck = layer === 'Forest' && ((qx * 7 + py * 13) % 23 === 0) ? 0.6 : layer === 'Field' && (qx + py) % 7 === 0 ? 0.9 : 1;
        img.data.set([c3[0] * shade * speck, c3[1] * shade * speck, c3[2] * shade * speck, 255], i);
      }
    }
    c.putImageData(img, 0, 0);
    c.strokeStyle = INK;
    c.lineWidth = 2.2 * k;
    c.lineJoin = 'round';
    for (const w of layout.walls) {
      c.beginPath();
      w.points.forEach((p, k) => {
        const q = toPx(p);
        if (k === 0) c.moveTo(q.x, q.y);
        else c.lineTo(q.x, q.y);
      });
      c.stroke();
    }
    c.fillStyle = '#b4a68a';
    c.lineWidth = 1.4 * k;
    for (const tw of layout.towers) {
      const q = toPx(tw.center);
      c.beginPath();
      c.arc(q.x, q.y, Math.max(2.5 * k, tw.radiusM * scale), 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    // toPx and the frame depend on the map only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, px]);

  // The marks: the plan's changes, then both armies.
  useEffect(() => {
    const c = ink.current?.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, px, px);
    const scenario = marks?.scenario ?? base;
    const cellPx = (i: number) => toPx({ x: (i % ctx.nav.width) + 0.5, z: Math.floor(i / ctx.nav.width) + 0.5 });
    // What the plan changes is ringed in dashed gold, so the eye finds it on the sheet.
    const ring = (q: { x: number; y: number }) => {
      c.save();
      c.strokeStyle = GOLD;
      c.lineWidth = 2.4 * k;
      c.setLineDash([5 * k, 4 * k]);
      c.beginPath();
      c.arc(q.x, q.y, CHANGE_RING_PX * k, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    };
    // A causeway already laid: timber across the moat.
    for (const id of scenario.filled ?? []) {
      c.fillStyle = 'rgb(122 86 46 / 90%)';
      const cells = fillCells(ctx, id);
      for (const i of cells) {
        const q = cellPx(i);
        c.fillRect(q.x - scale / 2, q.y - scale / 2, scale + 0.5, scale + 0.5);
      }
      const mid = cells[Math.floor(cells.length / 2)];
      if (mid !== undefined) ring(cellPx(mid));
    }
    // Weakened or fallen structures, in red.
    for (const s of scenario.structures ?? []) {
      const def = ctx.structures.find((d) => d.id === s.id);
      if (!def) continue;
      const q = toPx(def.center);
      ring(q);
      c.strokeStyle = THEIRS;
      c.lineWidth = 2.4 * k;
      if (def.kind === 'drawbridge' && s.broken) {
        c.fillStyle = '#8f6d46';
        for (const i of def.cells) {
          const p = cellPx(i);
          c.fillRect(p.x - scale / 2, p.y - scale / 2, scale + 0.5, scale + 0.5);
        }
      } else if (s.broken) {
        const r = 6 * k;
        c.beginPath();
        c.moveTo(q.x - r, q.y - r);
        c.lineTo(q.x + r, q.y + r);
        c.moveTo(q.x + r, q.y - r);
        c.lineTo(q.x - r, q.y + r);
        c.stroke();
      } else {
        // A crack: a zigzag over the structure.
        const r = 9 * k;
        c.beginPath();
        c.moveTo(q.x - r, q.y - r * 0.6);
        c.lineTo(q.x - r * 0.3, q.y + r * 0.2);
        c.lineTo(q.x + r * 0.2, q.y - r * 0.4);
        c.lineTo(q.x + r, q.y + r * 0.5);
        c.stroke();
      }
    }
    const added = new Set(marks?.added ?? []);
    for (const u of scenario.units) {
      const type = DEFAULT_RULES.units[u.typeKey];
      if (!type) continue;
      const q = toPx(u.position);
      const ours = type.faction === 'attacker';
      const engine = type.tags.includes('siegeEngine');
      const r = (engine ? 4.2 : type.tags.includes('hero') ? 3.8 : 3.2) * k;
      c.fillStyle = ours ? OURS : THEIRS;
      c.strokeStyle = INK;
      c.lineWidth = 1 * k;
      c.beginPath();
      if (engine) c.rect(q.x - r, q.y - r, r * 2, r * 2);
      else c.arc(q.x, q.y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      if (added.has(u.id)) {
        c.strokeStyle = GOLD;
        c.lineWidth = 2.2 * k;
        c.beginPath();
        c.arc(q.x, q.y, r + 3.5 * k, 0, Math.PI * 2);
        c.stroke();
      }
    }
    // Deserters and silenced sentries: crossed out where they stood.
    c.strokeStyle = THEIRS;
    c.lineWidth = 2.2 * k;
    for (const p of marks?.removed ?? []) {
      const q = toPx(p);
      const r = 4.5 * k;
      c.beginPath();
      c.moveTo(q.x - r, q.y - r);
      c.lineTo(q.x + r, q.y + r);
      c.moveTo(q.x + r, q.y - r);
      c.lineTo(q.x - r, q.y + r);
      c.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, base, ctx, px]);

  return (
    <div className="scout-plan">
      <canvas ref={ground} width={px} height={px} />
      <canvas ref={ink} width={px} height={px} />
    </div>
  );
}
