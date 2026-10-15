/**
 * Order feedback on the ground (brief §9.2): the selected unit's two movement contours (terrain
 * shader, see move-field.ts), a gold ring under it (under each of several men chosen together:
 * one instanced draw), a red ring under the targeted enemy, and the planned paths as painted
 * dashes, a single walk with a destination ring and its AP cost. Rebuilt when the
 * selection, the hover or the battle changes, never per frame; each frame only copies positions.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Vector3, type Camera } from 'three';
import { setDrawable } from '../drawable.ts';
import { findUnit, movementArea } from '../../core/battle/movement.ts';
import type { BattleState } from '../../core/battle/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import { deckAt } from '../../core/battle/context.ts';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
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
/** Rings under the men chosen together, at most (an army is smaller). */
const GROUP_RINGS_MAX = 32;
/** Dashes: length, gap and width (m), lifted above the ground (m). */
const DASH_M = 0.55;
const GAP_M = 0.4;
const DASH_WIDTH_M = 0.16;
const LIFT_M = 0.07;
const LABEL_HEIGHT_M = 0.9;
/** Guard cones: washes on the ground, ours in blue, theirs in red. */
const CONE_ENEMY_COLOR = '#d0463f';
/** Enemy guard cones: a light wash, shown while one of ours is selected (they matter to its move). */
const CONE_OPACITY = 0.09;
const CONE_RINGS = 14;
const CONE_SEGMENTS = 16;
const CONE_LIFT_M = 0.05;

function flatRing(radii: readonly [number, number], color: string): Mesh {
  const g = new RingGeometry(radii[0], radii[1], RING_SEGMENTS);
  g.rotateX(-Math.PI / 2);
  const m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide, fog: false });
  const mesh = new Mesh(g, m);
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}

/** Dashes along polylines, each a quad draped on the terrain. */
function dashGeometry(paths: readonly (readonly Vec2[])[], heightAt: (x: number, z: number) => number): BufferGeometry {
  const positions: number[] = [];
  const quad = (a: Vec2, b: Vec2) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (DASH_WIDTH_M / 2);
    const nz = (dx / len) * (DASH_WIDTH_M / 2);
    const ya = heightAt(a.x, a.z) + LIFT_M;
    const yb = heightAt(b.x, b.z) + LIFT_M;
    const p = [
      [a.x - nx, ya, a.z - nz],
      [a.x + nx, ya, a.z + nz],
      [b.x + nx, yb, b.z + nz],
      [b.x - nx, yb, b.z - nz],
    ] as const;
    for (const k of [0, 1, 2, 0, 2, 3]) positions.push(...(p[k] as readonly number[]));
  };
  for (const path of paths) {
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
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

/**
 * Guard cones of every unit on overwatch (theirs in red: walking into one draws a reaction shot),
 * as fans draped on the terrain, one merged geometry. Pieces straddling a deck edge (a wall-walk
 * above the ground it watches) are left out: no sheet hangs down the wall.
 */
function guardCones(session: BattleSession): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const half = (session.ctx.rules.damage.overwatchHalfAngleDeg * Math.PI) / 180;
  const enemy = new Color(CONE_ENEMY_COLOR);
  for (const unit of session.state.units) {
    // Only the enemy's: ours are told by their card and their float (review J5b).
    if (!unit.alive || !unit.overwatch || unit.faction === PLAYER_FACTION) continue;
    const range = session.ctx.rules.units[unit.typeKey]?.attack?.rangeM ?? 0;
    if (range <= 0) continue;
    const color = enemy;
    const heading = Math.atan2(unit.overwatch.x, unit.overwatch.z);
    const at = (r: number, a: number): readonly [number, number, number, number] => {
      const x = unit.position.x + Math.sin(a) * r;
      const z = unit.position.z + Math.cos(a) * r;
      return [x, session.standHeight(x, z) + CONE_LIFT_M, z, deckAt(session.ctx, { x, z })];
    };
    for (let ring = 0; ring < CONE_RINGS; ring++) {
      const r0 = (range * ring) / CONE_RINGS;
      const r1 = (range * (ring + 1)) / CONE_RINGS;
      for (let k = 0; k < CONE_SEGMENTS; k++) {
        const a0 = heading - half + (2 * half * k) / CONE_SEGMENTS;
        const a1 = heading - half + (2 * half * (k + 1)) / CONE_SEGMENTS;
        const quad = [at(r0, a0), at(r1, a0), at(r1, a1), at(r0, a1)];
        const decks = quad.map((q) => q[3]);
        if (Math.max(...decks) - Math.min(...decks) > session.ctx.nav.maxDeckStepM) continue;
        for (const i of [0, 1, 2, 0, 2, 3]) {
          const q = quad[i] as readonly number[];
          positions.push(q[0] as number, q[1] as number, q[2] as number);
          colors.push(color.r, color.g, color.b);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  return g;
}

export function BattleOverlays({ session, handles, terrain }: { readonly session: BattleSession; readonly handles: ReadonlyMap<string, UnitHandle> | null; readonly terrain: TerrainData }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as Camera;
  const parts = useMemo(() => {
    const selectRing = flatRing(RING_RADII_M, SELECT_COLOR);
    const groupRings = new InstancedMesh(selectRing.geometry, selectRing.material, GROUP_RINGS_MAX);
    groupRings.count = 0;
    groupRings.visible = false;
    groupRings.renderOrder = 2;
    groupRings.frustumCulled = false;
    const targetRing = flatRing(RING_RADII_M, TARGET_COLOR);
    const destRing = flatRing(DEST_RADII_M, PATH_COLOR);
    const pathMaterial = new MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide, fog: false });
    const path = new Mesh(new BufferGeometry(), pathMaterial);
    path.renderOrder = 2;
    path.visible = false;
    path.frustumCulled = false;
    const coneMaterial = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: CONE_OPACITY, depthWrite: false, side: DoubleSide, fog: false });
    const cones = new Mesh(new BufferGeometry(), coneMaterial);
    cones.name = 'Overlays:cones';
    setDrawable(cones, false);
    cones.renderOrder = 1;
    cones.frustumCulled = false;
    return { selectRing, groupRings, targetRing, destRing, path, pathMaterial, cones, coneMaterial };
  }, []);
  const lastBattle = useRef<BattleState | null>(null);
  const silhouetted = useRef<UnitHandle[]>([]);
  const follow = useRef<{ select: UnitHandle | null; group: UnitHandle[]; target: UnitHandle | null }>({ select: null, group: [], target: null });
  const ringPlace = useRef(new Object3D());
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
      follow.current.group = ui.group.map((id) => (findUnit(state, id)?.alive ? handles?.get(id) : undefined)).filter((h): h is UnitHandle => h !== undefined).slice(0, GROUP_RINGS_MAX);
      const together = follow.current.group.length > 1;
      parts.selectRing.visible = follow.current.select !== null && !together;
      parts.groupRings.visible = together;
      if (!together) parts.groupRings.count = 0;
      showMoveArea(active && selected && !together ? movementArea(session.ctx, state, selected.id) : null, session.ctx.nav.width, session.ctx.nav.cellSize);
      const hover = ui.hover;
      const advice = ui.advice && ui.advice.unitId === selected?.id ? ui.advice : null;
      const targetId = advice ? advice.targetId : hover.kind === 'attack' ? hover.preview.targetId : null;
      follow.current.target = targetId ? (handles?.get(targetId) ?? null) : null;
      parts.targetRing.visible = follow.current.target !== null;
      // Seen through what hides them: the selected unit and the targeted enemy.
      const lit = [follow.current.select, follow.current.target].filter((h): h is UnitHandle => h !== null);
      for (const h of silhouetted.current) if (!lit.includes(h)) h.setSilhouette(false);
      for (const h of lit) h.setSilhouette(true);
      silhouetted.current = lit;
      // A move, or the walk before a deed out of reach (a blow, works, a shot): its path, its end, its cost.
      const walk = advice ? (advice.walk ?? undefined) : hover.kind === 'move' ? hover.plan : 'approach' in hover ? hover.approach?.plan : undefined;
      const walks = hover.kind === 'group' ? hover.walks : [];
      if (walks.length > 0 && active) {
        // Several men: their paths, without the single walk's ring and cost.
        parts.path.geometry.dispose();
        parts.path.geometry = dashGeometry(walks.map((w) => w.path), (x, z) => session.standHeight(x, z));
        parts.path.visible = true;
        parts.destRing.visible = false;
        label.current.on = false;
      } else if (walk && active) {
        parts.path.geometry.dispose();
        parts.path.geometry = dashGeometry([walk.path], (x, z) => session.standHeight(x, z));
        parts.path.visible = true;
        const d = walk.destination;
        parts.destRing.position.set(d.x, session.standHeight(d.x, d.z) + LIFT_M, d.z);
        parts.destRing.visible = true;
        label.current.at.set(d.x, session.standHeight(d.x, d.z) + LABEL_HEIGHT_M, d.z);
        label.current.on = true;
        if (label.current.el) label.current.el.textContent = `${walk.apSpent} point${walk.apSpent > 1 ? 's' : ''}`;
      } else {
        parts.path.visible = false;
        parts.destRing.visible = false;
        label.current.on = false;
      }
      if (label.current.el) label.current.el.hidden = !label.current.on;
      if (lastBattle.current !== state) {
        lastBattle.current = state;
        parts.cones.geometry.dispose();
        parts.cones.geometry = guardCones(session);
      }
      setDrawable(parts.cones, ui.selectedId !== null && (parts.cones.geometry.getAttribute('position')?.count ?? 0) > 0);
    };
    refresh();
    const unsubscribe = useBattleUi.subscribe((s, prev) => {
      if (s.selectedId !== prev.selectedId || s.group !== prev.group || s.hover !== prev.hover || s.busy !== prev.busy || s.battle !== prev.battle || s.advice !== prev.advice) refresh();
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
      // Its geometry and material are the select ring's (disposed above); its instances are its own.
      parts.groupRings.dispose();
      parts.path.geometry.dispose();
      parts.pathMaterial.dispose();
      parts.cones.geometry.dispose();
      parts.coneMaterial.dispose();
    },
    [parts],
  );

  useFrame(() => {
    const { select, group, target } = follow.current;
    if (select) parts.selectRing.position.set(select.root.position.x, select.root.position.y + LIFT_M, select.root.position.z);
    if (group.length > 1) {
      const place = ringPlace.current;
      for (let i = 0; i < group.length; i++) {
        const p = (group[i] as UnitHandle).root.position;
        place.position.set(p.x, p.y + LIFT_M, p.z);
        place.updateMatrix();
        parts.groupRings.setMatrixAt(i, place.matrix);
      }
      parts.groupRings.count = group.length;
      parts.groupRings.instanceMatrix.needsUpdate = true;
    }
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
      <primitive object={parts.groupRings} />
      <primitive object={parts.targetRing} />
      <primitive object={parts.destRing} />
      <primitive object={parts.path} />
      <primitive object={parts.cones} />
    </>
  );
}
