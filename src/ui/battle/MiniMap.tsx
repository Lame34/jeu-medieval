/**
 * Mini-map (brief §10): the playable map painted from its terrain layers, the castle's walls,
 * the units (the enemies the player's men cannot see stay hidden under fog), the camera's view
 * and the wind. A click recentres the camera there. The ground is painted once; the marks are
 * redrawn on battle events and, a few times a second, when the camera has moved (no React state
 * per frame).
 */
import { useEffect, useRef } from 'react';
import { isSeenBy } from '../../core/battle/conditions.ts';
import type { BattleState } from '../../core/battle/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import { TERRAIN_LAYER_KEYS, type TerrainLayerKey } from '../../core/rules/types.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import type { CameraView } from '../../render/camera/TacticalCamera.tsx';
import { PALETTE } from '../../render/materials/palette.ts';
import { PLAYER_FACTION, type BattleSession } from './session.ts';

/** Canvas size (px) and how often the camera mark is refreshed (ms). */
const SIZE_PX = 196;
const CAMERA_POLL_MS = 250;
const UNIT_DOT_PX = 3.2;
const VIEW_WEDGE_PX = 16;
const WIND_ARROW_PX = 14;

/** A painted, muted map: the layers in the scene's own hues. */
const LAYER_COLOR: Readonly<Record<TerrainLayerKey, string>> = {
  Plain: '#7d8a52',
  Road: '#b09468',
  Field: '#bfa45c',
  Forest: '#41583a',
  Mud: '#7a6448',
  Ford: '#5f7a78',
  River: '#4e6e78',
  Moat: '#3e5246',
  Rock: '#7c776c',
  Building: '#8e5a42',
  Wall: '#9a9282',
  Bridge: '#7a5a3c',
  Rubble: '#8a8274',
  Hedge: '#4f6638',
  DryStoneWall: '#8c8676',
  Rampart: '#a49c8c',
  Stair: '#a49c8c',
  Fascine: '#8a6a44',
};

export function MiniMap({ layout, session, getView, onFocus }: { readonly layout: WorldLayout; readonly session: BattleSession; readonly getView: () => CameraView | null; readonly onFocus: (p: Vec2) => void }) {
  const ground = useRef<HTMLCanvasElement | null>(null);
  const marks = useRef<HTMLCanvasElement | null>(null);
  const { playable, terrain } = layout;
  const spanX = playable.maxX - playable.minX;
  const spanZ = playable.maxZ - playable.minZ;
  const scale = SIZE_PX / Math.max(spanX, spanZ);
  const toPx = (p: Vec2) => ({ x: (p.x - playable.minX) * scale, y: (p.z - playable.minZ) * scale });

  // The ground, once: one sample per pixel.
  useEffect(() => {
    const c = ground.current?.getContext('2d');
    if (!c) return;
    const img = c.createImageData(SIZE_PX, SIZE_PX);
    const rgb = TERRAIN_LAYER_KEYS.map((k) => {
      const hex = LAYER_COLOR[k];
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    });
    for (let py = 0; py < SIZE_PX; py++) {
      for (let px = 0; px < SIZE_PX; px++) {
        const x = Math.floor(playable.minX + (px + 0.5) / scale);
        const z = Math.floor(playable.minZ + (py + 0.5) / scale);
        const i = (py * SIZE_PX + px) * 4;
        if (x < 0 || z < 0 || x >= terrain.width || z >= terrain.depth || x > playable.maxX || z > playable.maxZ) {
          img.data[i + 3] = 0;
          continue;
        }
        const c3 = rgb[terrain.layers[z * terrain.width + x] as number] ?? [0, 0, 0];
        img.data.set([c3[0] as number, c3[1] as number, c3[2] as number, 255], i);
      }
    }
    c.putImageData(img, 0, 0);
    // The castle's walls and towers, inked.
    c.strokeStyle = '#2b2326';
    c.lineWidth = 1.6;
    for (const w of layout.walls) {
      c.beginPath();
      w.points.forEach((p, k) => {
        const q = toPx(p);
        if (k === 0) c.moveTo(q.x, q.y);
        else c.lineTo(q.x, q.y);
      });
      c.stroke();
    }
    c.fillStyle = '#9a9282';
    for (const t of layout.towers) {
      const q = toPx(t.center);
      c.beginPath();
      c.arc(q.x, q.y, Math.max(1.5, t.radiusM * scale), 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    // toPx depends on the layout only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // The marks: units, camera view, wind.
  useEffect(() => {
    const draw = (state: BattleState) => {
      const c = marks.current?.getContext('2d');
      if (!c) return;
      c.clearRect(0, 0, SIZE_PX, SIZE_PX);
      for (const u of state.units) {
        if (!u.alive) continue;
        if (u.faction !== PLAYER_FACTION && !isSeenBy(session.ctx, state, PLAYER_FACTION, u.position)) continue;
        const q = toPx(u.position);
        c.fillStyle = u.faction === 'attacker' ? PALETTE.attacker.primary : PALETTE.defender.primary;
        c.strokeStyle = '#1b1416';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(q.x, q.y, UNIT_DOT_PX, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
      const view = getView();
      if (view) {
        const q = toPx(view.focus);
        const yaw = view.yawTurns * 2 * Math.PI;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const spread = 0.55;
        c.fillStyle = 'rgb(232 217 181 / 30%)';
        c.strokeStyle = '#e8d9b5';
        c.beginPath();
        c.moveTo(q.x - fx * 4, q.y - fz * 4);
        for (const s of [-spread, spread]) {
          const ax = fx * Math.cos(s) - fz * Math.sin(s);
          const az = fx * Math.sin(s) + fz * Math.cos(s);
          c.lineTo(q.x + ax * VIEW_WEDGE_PX, q.y + az * VIEW_WEDGE_PX);
        }
        c.closePath();
        c.fill();
        c.stroke();
      }
      // The wind, blowing towards where the arrow points (fire spreads that way).
      const w = state.wind;
      const len = Math.hypot(w.x, w.z) || 1;
      const ox = SIZE_PX - 20;
      const oy = 20;
      const ax = (w.x / len) * WIND_ARROW_PX * (0.5 + 0.5 * w.strength);
      const az = (w.z / len) * WIND_ARROW_PX * (0.5 + 0.5 * w.strength);
      c.strokeStyle = '#e8d9b5';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(ox - ax, oy - az);
      c.lineTo(ox + ax, oy + az);
      c.stroke();
      const head = Math.atan2(az, ax);
      c.beginPath();
      c.moveTo(ox + ax, oy + az);
      c.lineTo(ox + ax - Math.cos(head - 0.5) * 6, oy + az - Math.sin(head - 0.5) * 6);
      c.lineTo(ox + ax - Math.cos(head + 0.5) * 6, oy + az - Math.sin(head + 0.5) * 6);
      c.closePath();
      c.fillStyle = '#e8d9b5';
      c.fill();
    };
    draw(session.state);
    const off = session.subscribe((_, state) => draw(state));
    let last = '';
    const timer = window.setInterval(() => {
      const v = getView();
      const key = v ? `${v.focus.x.toFixed(1)},${v.focus.z.toFixed(1)},${v.yawTurns.toFixed(3)}` : '';
      if (key !== last) {
        last = key;
        draw(session.state);
      }
    }, CAMERA_POLL_MS);
    return () => {
      off();
      window.clearInterval(timer);
    };
    // toPx depends on the layout only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, getView, layout]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * SIZE_PX;
    const py = ((e.clientY - r.top) / r.height) * SIZE_PX;
    onFocus({ x: playable.minX + px / scale, z: playable.minZ + py / scale });
  };

  return (
    <div className="hud-minimap" style={{ width: SIZE_PX, height: Math.round(spanZ * scale) }}>
      <canvas ref={ground} width={SIZE_PX} height={SIZE_PX} aria-hidden="true" />
      <canvas ref={marks} width={SIZE_PX} height={SIZE_PX} onClick={click} aria-label="Mini-carte : cliquer pour y centrer la vue" />
    </div>
  );
}
