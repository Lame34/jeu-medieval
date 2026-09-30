/**
 * Order feedback on the ground (brief §9.2): the selected unit's two movement contours (terrain
 * shader, see move-field.ts), a gold ring under it, a red ring under the targeted enemy, and the
 * planned path as painted dashes with a destination ring and its AP cost. Rebuilt when the
 * selection, the hover or the battle changes, never per frame; each frame only copies positions.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Camera } from 'three';
import { findUnit, movementArea } from '../../core/battle/movement.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { useBattleUi } from '../../state/battle-ui.ts';
import { PLAYER_FACTION, type BattleSession } from '../../ui/battle/session.ts';
import type { UnitHandle } from '../units/Units.tsx';
import { showMoveArea } from './move-field.ts';

const SELECT_COLOR = '#e6c35a';
const TARGET_COLOR = '#c8323a';
const PATH_COLOR = '#f2e6c8';
const RING_RADII_M: readonly [number, number] = [0.72, 0.92];
const DEST_RADII_M: readonly [number, number] = [0.35, 0.5];
const RING_SEGMENTS = 40;
/** Dashes: length, gap and width (m), lifted above the ground (m). */
const DASH_M = 0.55;
const GAP_M = 0.4;
const DASH_WIDTH_M = 0.16;
const LIFT_M = 0.07;
const LABEL_HEIGHT_M = 0.9;

function flatRing(radii: readonly [number, number], color: string): Mesh {
  const g = new RingGeometry(radii[0], radii[1], RING_SEGMENTS);
  g.rotateX(-Math.PI / 2);
  const m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide, fog: false });
  const mesh = new Mesh(g, m);
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

/** Dashes along a polyline, each a quad draped on the terrain. */
function dashGeometry(path: readonly Vec2[], terrain: TerrainData): BufferGeometry {
  const positions: number[] = [];
  const quad = (a: Vec2, b: Vec2) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (DASH_WIDTH_M / 2);
    const nz = (dx / len) * (DASH_WIDTH_M / 2);
    const ya = sampleHeight(terrain, a.x, a.z) + LIFT_M;
    const yb = sampleHeight(terrain, b.x, b.z) + LIFT_M;
    const p = [
      [a.x - nx, ya, a.z - nz],
      [a.x + nx, ya, a.z + nz],
      [b.x + nx, yb, b.z + nz],
      [b.x - nx, yb, b.z - nz],
    ] as const;
    for (const k of [0, 1, 2, 0, 2, 3]) positions.push(...(p[k] as readonly number[]));
  };
  let carry = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Vec2;
    const b = path[i + 1] as Vec2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let s = carry;
    while (s < len) {
      const e = Math.min(len, s + DASH_M);
      const t0 = s / len;
      const t1 = e / len;
      quad({ x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 }, { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 });
      s = e + GAP_M;
    }
    carry = s - len;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

export function BattleOverlays({ session, handles, terrain }: { readonly session: BattleSession; readonly handles: ReadonlyMap<string, UnitHandle> | null; readonly terrain: TerrainData }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as Camera;
  const parts = useMemo(() => {
    const selectRing = flatRing(RING_RADII_M, SELECT_COLOR);
    const targetRing = flatRing(RING_RADII_M, TARGET_COLOR);
    const destRing = flatRing(DEST_RADII_M, PATH_COLOR);
    const pathMaterial = new MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide, fog: false });
    const path = new Mesh(new BufferGeometry(), pathMaterial);
    path.renderOrder = 2;
    path.visible = false;
    path.frustumCulled = false;
    return { selectRing, targetRing, destRing, path, pathMaterial };
  }, []);
  const follow = useRef<{ select: UnitHandle | null; target: UnitHandle | null }>({ select: null, target: null });
  const label = useRef<{ el: HTMLSpanElement | null; at: Vector3; on: boolean }>({ el: null, at: new Vector3(), on: false });
  const scratch = useRef(new Vector3());

  // AP label over the destination (DOM, projected per frame).
  useEffect(() => {
    const host = gl.domElement.parentElement;
    if (!host) return undefined;
    const el = document.createElement('span');
    el.className = 'battle-float battle-ap-label';
    el.hidden = true;
    host.appendChild(el);
    const slot = label.current;
    slot.el = el;
    return () => {
      el.remove();
      slot.el = null;
    };
  }, [gl]);

  useEffect(() => {
    const refresh = () => {
      const ui = useBattleUi.getState();
      const state = session.state;
      const selected = ui.selectedId ? findUnit(state, ui.selectedId) : undefined;
      const active = Boolean(selected?.alive) && state.activeFaction === PLAYER_FACTION && state.status === 'ongoing' && !ui.busy;
      follow.current.select = selected?.alive ? (handles?.get(selected.id) ?? null) : null;
      parts.selectRing.visible = follow.current.select !== null;
      showMoveArea(active && selected ? movementArea(session.ctx, state, selected.id) : null, session.ctx.nav.width, session.ctx.nav.cellSize);
      const hover = ui.hover;
      follow.current.target = hover.kind === 'attack' ? (handles?.get(hover.preview.targetId) ?? null) : null;
      parts.targetRing.visible = follow.current.target !== null;
      if (hover.kind === 'move' && active) {
        parts.path.geometry.dispose();
        parts.path.geometry = dashGeometry(hover.plan.path, terrain);
        parts.path.visible = true;
        const d = hover.plan.destination;
        parts.destRing.position.set(d.x, sampleHeight(terrain, d.x, d.z) + LIFT_M, d.z);
        parts.destRing.visible = true;
        label.current.at.set(d.x, sampleHeight(terrain, d.x, d.z) + LABEL_HEIGHT_M, d.z);
        label.current.on = true;
        if (label.current.el) label.current.el.textContent = `${hover.plan.apSpent} PA`;
      } else {
        parts.path.visible = false;
        parts.destRing.visible = false;
        label.current.on = false;
      }
      if (label.current.el) label.current.el.hidden = !label.current.on;
    };
    refresh();
    const unsubscribe = useBattleUi.subscribe((s, prev) => {
      if (s.selectedId !== prev.selectedId || s.hover !== prev.hover || s.busy !== prev.busy || s.battle !== prev.battle) refresh();
    });
    return () => {
      unsubscribe();
      showMoveArea(null, 0, 1);
    };
  }, [session, handles, terrain, parts]);

  useEffect(
    () => () => {
      for (const m of [parts.selectRing, parts.targetRing, parts.destRing]) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
      parts.path.geometry.dispose();
      parts.pathMaterial.dispose();
    },
    [parts],
  );

  useFrame(() => {
    const { select, target } = follow.current;
    if (select) parts.selectRing.position.set(select.root.position.x, select.root.position.y + LIFT_M, select.root.position.z);
    if (target) parts.targetRing.position.set(target.root.position.x, target.root.position.y + LIFT_M, target.root.position.z);
    const l = label.current;
    if (l.on && l.el) {
      const v = scratch.current.copy(l.at).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      l.el.style.transform = `translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px) translate(-50%, -100%)`;
    }
  });

  return (
    <>
      <primitive object={parts.selectRing} />
      <primitive object={parts.targetRing} />
      <primitive object={parts.destRing} />
      <primitive object={parts.path} />
    </>
  );
}
