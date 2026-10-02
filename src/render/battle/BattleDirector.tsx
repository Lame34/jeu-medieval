/**
 * Plays a battle on screen (J3). Core events arrive from the BattleSession and are played one at
 * a time: moves along their path, blows (attack clip, then the target's reaction at the moment
 * of impact, with floating damage), deaths, guards. Input: the pointer ray is marched along the
 * heightfield (no dependency on the terrain meshes); hovering previews the order (the HUD shows
 * it), clicking selects, moves or attacks; G sets a guard towards the pointer, Enter ends the
 * turn, Escape deselects. When the player's turn ends, the AI plays its turn.
 *
 * Siege (J4): a selected engine aims at the castle structure under the pointer (the ground hit
 * marches over the wall-walks, so a wall face resolves to its segment); blows crack and dust the
 * castle through its handle, and a structure coming down plays its fall (collapse, smashed gate,
 * dropped drawbridge) while the units on a collapsing wall-walk fall with it.
 *
 * Nothing here allocates per frame or calls setState per frame: the store changes on events and
 * on hover changes only.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Raycaster, Vector2, Vector3, type Camera } from 'three';
import { previewAttack } from '../../core/battle/combat.ts';
import type { BattleContext } from '../../core/battle/context.ts';
import { distanceToStructure, previewStructureAttack, SIEGE_ENGINE_TAG } from '../../core/battle/siege.ts';
import { isBroken, structureDef, type StructureDef } from '../../core/battle/structures.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import type { CastleHandle } from '../castle/Castle.tsx';
import { findUnit, planMove } from '../../core/battle/movement.ts';
import type { BattleState } from '../../core/battle/types.ts';
import type { Command } from '../../core/commands/types.ts';
import { threatsAt } from '../../core/battle/overwatch.ts';
import type { GameEvent } from '../../core/events/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { useBattleUi, type HoverPreview } from '../../state/battle-ui.ts';
import { PLAYER_FACTION, type BattleSession } from '../../ui/battle/session.ts';
import { describeEvent } from '../../ui/battle/describe.ts';
import { ENGINE_SPEED_MS, engineKindOf } from '../units/engines.ts';
import type { UnitHandle } from '../units/Units.tsx';

/** Walking and running speeds (m/s); paths longer than RUN_FROM_M are run. */
const WALK_SPEED = 2.2;
const RUN_SPEED = 5;
const RUN_FROM_M = 6;
/** Turn rate while moving (radians per second). */
const TURN_RATE = 10;
/** A blow lands at this fraction of the attack clip. */
const IMPACT_AT = 0.45;
const ATTACK_DURATION_S: readonly [number, number] = [0.7, 1.4];
const GUARD_PAUSE_S = 0.5;
const TURN_BANNER_S = 0.9;
/** Pointer travel (px) above which a press is a drag, not a click. */
const CLICK_SLOP_PX = 6;
/** Ray march along the view ray over the heightfield (m). */
const RAY_STEP_M = 1;
const RAY_MAX_M = 900;
/** A unit is under the pointer when the ray passes this close to its axis (m). */
const PICK_RADIUS_M = 0.8;
const UNIT_PICK_HEIGHT_M = 2.2;
/** A structure is under the pointer when the ground hit lies this close to its cells (m). */
const STRUCTURE_PICK_M = 1.6;
/** Units thrown down by a collapsing wall-walk land over this fraction of the collapse. */
const FALL_FRACTION = 0.45;
/** Floating texts (damage, misses, guards). */
const FLOAT_POOL = 16;
const FLOAT_LIFE_S = 1.4;
const FLOAT_RISE_M = 1.2;
const FLOAT_HEIGHT_M = 2.6;
/** Tests (`?fast`) play the animation queue this much faster. */
const TIME_SCALE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fast') ? 8 : 1;

interface Step {
  duration: number;
  update(t: number, dt: number): void;
  finish(): void;
}

interface FloatText {
  readonly el: HTMLSpanElement;
  readonly at: Vector3;
  age: number;
}

/**
 * The structure an engine would strike at `p`: the nearest within reach, the drawbridge last (it
 * spans the ground in front of the gate), the portcullis once the gate in front of it is down.
 */
function structureAt(ctx: BattleContext, state: BattleState, p: Vec2): StructureDef | null {
  let best: StructureDef | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const def of ctx.structures) {
    if (isBroken(state.structures, def.id)) continue;
    const d = distanceToStructure(ctx, def, p);
    if (d > STRUCTURE_PICK_M) continue;
    const score = d + (def.kind === 'drawbridge' ? STRUCTURE_PICK_M * 2 : 0);
    if (score < bestScore) {
      best = def;
      bestScore = score;
    }
  }
  if (best?.kind === 'gate' || best?.kind === 'portcullis') {
    const gate = ctx.structures.find((d) => d.kind === 'gate' && d.gateId === best?.gateId);
    const portcullis = ctx.structures.find((d) => d.kind === 'portcullis' && d.gateId === best?.gateId);
    best = gate && !isBroken(state.structures, gate.id) ? gate : (portcullis ?? best);
  }
  return best;
}

function isSiegeEngine(typeKey: string): boolean {
  const type = DEFAULT_RULES.units[typeKey];
  return Boolean(type?.attack && type.tags.includes(SIEGE_ENGINE_TAG));
}

function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function approachAngle(from: number, to: number, maxStep: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}

/** First point where the view ray meets the ground (relief + decks), or null when it leaves the map. */
function groundHit(ray: Raycaster['ray'], terrain: TerrainData, heightAt: (x: number, z: number) => number, out: Vector3): boolean {
  const W = terrain.width * terrain.cellSize;
  const D = terrain.depth * terrain.cellSize;
  let prevT = 0;
  for (let t = RAY_STEP_M; t <= RAY_MAX_M; t += RAY_STEP_M) {
    ray.at(t, out);
    if (out.x < 0 || out.z < 0 || out.x >= W || out.z >= D) {
      prevT = t;
      continue;
    }
    if (out.y <= heightAt(out.x, out.z)) {
      // Bisect between the last point above and this one.
      let lo = prevT;
      let hi = t;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        ray.at(mid, out);
        if (out.y <= heightAt(out.x, out.z)) hi = mid;
        else lo = mid;
      }
      ray.at(hi, out);
      return true;
    }
    prevT = t;
  }
  return false;
}

export function BattleDirector({
  session,
  handles,
  castle = null,
  terrain,
  focusOn,
}: {
  readonly session: BattleSession;
  readonly handles: ReadonlyMap<string, UnitHandle> | null;
  /** The castle's siege handle (structures), once the castle is built. */
  readonly castle?: CastleHandle | null;
  readonly terrain: TerrainData;
  /** Recentres the camera (Tab, double-click on a unit of ours). */
  readonly focusOn?: (p: Vec2) => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as Camera;
  const queue = useRef<GameEvent[]>([]);
  const step = useRef<{ step: Step; t: number } | null>(null);
  const floats = useRef<FloatText[]>([]);
  const scratch = useRef({ v: new Vector3(), ground: new Vector3(), ndc: new Vector2(), ray: new Raycaster(), p: new Vector3() });
  const pointer = useRef({ x: 0, y: 0, downX: 0, downY: 0, down: false, inside: false });
  const hoverKey = useRef('');
  const aiPending = useRef(false);

  // --- Floating texts: a small DOM pool over the canvas, projected every frame ---------------
  useEffect(() => {
    const host = gl.domElement.parentElement;
    if (!host) return undefined;
    const layer = document.createElement('div');
    layer.className = 'battle-floats';
    host.appendChild(layer);
    floats.current = Array.from({ length: FLOAT_POOL }, () => {
      const el = document.createElement('span');
      el.className = 'battle-float';
      el.hidden = true;
      layer.appendChild(el);
      return { el, at: new Vector3(), age: FLOAT_LIFE_S };
    });
    return () => {
      layer.remove();
      floats.current = [];
    };
  }, [gl]);

  const showFloat = (text: string, tone: string, x: number, y: number, z: number) => {
    const slot = floats.current.reduce<FloatText | null>((best, f) => (!best || f.age > best.age ? f : best), null);
    if (!slot) return;
    slot.el.textContent = text;
    slot.el.dataset['tone'] = tone;
    slot.el.hidden = false;
    slot.at.set(x, y, z);
    slot.age = 0;
  };

  // --- Session events → queue ------------------------------------------------------------
  useEffect(() => {
    const ui = useBattleUi.getState();
    ui.setBattle(session.state);
    return session.subscribe((events, state) => {
      queue.current.push(...events);
      const store = useBattleUi.getState();
      store.setBattle(state);
      const lines = events.map((e) => describeEvent(e, state)).filter((l): l is string => l !== null);
      if (lines.length > 0) store.pushLog(lines);
      if (events.length > 0) store.setBusy(true);
    });
  }, [session]);

  const handleOf = (id: string) => handles?.get(id) ?? null;

  const makeStep = (event: GameEvent): Step | null => {
    switch (event.type) {
      case 'unitMoved': {
        const h = handleOf(event.unitId);
        const path = event.path;
        if (!h || path.length < 2) return null;
        const lengths = [0];
        for (let i = 1; i < path.length; i++) lengths.push((lengths[i - 1] as number) + Math.hypot((path[i] as Vec2).x - (path[i - 1] as Vec2).x, (path[i] as Vec2).z - (path[i - 1] as Vec2).z));
        const total = lengths[lengths.length - 1] as number;
        // Engines roll at their own pace; soldiers run longer moves.
        const engine = engineKindOf(findUnit(session.state, event.unitId)?.typeKey ?? '') !== null;
        const run = !engine && total > RUN_FROM_M;
        const speed = engine ? ENGINE_SPEED_MS : run ? RUN_SPEED : WALK_SPEED;
        h.play(run ? 'run' : 'walk');
        let segment = 0;
        return {
          duration: total / speed,
          update(t, dt) {
            const s = Math.min(total, t * speed);
            while (segment < path.length - 2 && (lengths[segment + 1] as number) < s) segment++;
            const a = path[segment] as Vec2;
            const b = path[segment + 1] as Vec2;
            const len = (lengths[segment + 1] as number) - (lengths[segment] as number);
            const k = len > 0 ? (s - (lengths[segment] as number)) / len : 1;
            const x = a.x + (b.x - a.x) * k;
            const z = a.z + (b.z - a.z) * k;
            h.root.position.set(x, session.standHeight(x, z), z);
            h.root.rotation.y = approachAngle(h.root.rotation.y, yawOf(b.x - a.x, b.z - a.z), TURN_RATE * dt);
          },
          finish() {
            const end = path[path.length - 1] as Vec2;
            h.root.position.set(end.x, session.standHeight(end.x, end.z), end.z);
            h.play('idle');
          },
        };
      }
      case 'unitAttacked': {
        const attacker = handleOf(event.attackerId);
        const target = handleOf(event.targetId);
        if (!attacker || !target) return null;
        const clip = attacker.play('attack', true);
        const duration = Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip));
        const facing = yawOf(target.root.position.x - attacker.root.position.x, target.root.position.z - attacker.root.position.z);
        let landed = false;
        return {
          duration,
          update(t, dt) {
            attacker.root.rotation.y = approachAngle(attacker.root.rotation.y, facing, TURN_RATE * dt);
            if (!landed && t >= duration * IMPACT_AT) {
              landed = true;
              const p = target.root.position;
              if (event.hit) {
                if (event.hpAfter > 0) target.play('hit', true);
                showFloat(`${event.crit ? 'Critique ! ' : ''}−${event.damage}`, event.crit ? 'crit' : 'hit', p.x, p.y + FLOAT_HEIGHT_M, p.z);
              } else showFloat('Raté', 'miss', p.x, p.y + FLOAT_HEIGHT_M, p.z);
            }
          },
          finish() {
            attacker.play('idle');
            if (event.hpAfter > 0 && event.hit) target.play('idle');
          },
        };
      }
      case 'structureDamaged': {
        const attacker = handleOf(event.attackerId);
        const def = structureDef(session.ctx, event.structureId);
        if (!def) return null;
        const clip = attacker ? attacker.play('attack', true) : ATTACK_DURATION_S[0];
        const duration = Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip));
        const facing = attacker ? yawOf(def.center.x - attacker.root.position.x, def.center.z - attacker.root.position.z) : 0;
        let landed = false;
        return {
          duration,
          update(t, dt) {
            if (attacker) attacker.root.rotation.y = approachAngle(attacker.root.rotation.y, facing, TURN_RATE * dt);
            if (!landed && t >= duration * IMPACT_AT) {
              landed = true;
              if (event.hit) castle?.hit(event.structureId, def.maxHp > 0 ? event.hpAfter / def.maxHp : 1);
              const p = scratch.current.p;
              if (castle?.anchorOf(event.structureId, p)) showFloat(event.hit ? `${event.crit ? 'Critique ! ' : ''}−${event.damage}` : 'Raté', event.hit ? (event.crit ? 'crit' : 'hit') : 'miss', p.x, p.y, p.z);
            }
          },
          finish() {
            attacker?.play('idle');
          },
        };
      }
      case 'structureBroken': {
        const duration = castle?.bringDown(event.structureId) ?? 0;
        // Units on a collapsing wall-walk come down with it (their deaths follow as events).
        const falling = event.fallen
          .map((f) => ({ f, h: handleOf(f.unitId) }))
          .filter((x): x is { f: (typeof event.fallen)[number]; h: UnitHandle } => x.h !== null)
          .map(({ f, h }) => ({ f, h, from: h.root.position.y, to: session.standHeight(h.root.position.x, h.root.position.z) }));
        for (const { f, h } of falling) if (f.hpAfter > 0) h.play('hit', true);
        return {
          duration: Math.max(duration, TURN_BANNER_S),
          update(t) {
            const k = Math.min(1, t / Math.max(0.01, duration * FALL_FRACTION));
            for (const x of falling) x.h.root.position.y = x.from + (x.to - x.from) * k * k;
          },
          finish() {
            for (const x of falling) {
              x.h.root.position.y = x.to;
              if (x.f.hpAfter > 0) x.h.play('idle');
              const p = x.h.root.position;
              showFloat(`−${x.f.damage}`, 'hit', p.x, p.y + FLOAT_HEIGHT_M, p.z);
            }
          },
        };
      }
      case 'unitDied': {
        const h = handleOf(event.unitId);
        if (!h) return null;
        const duration = h.play('death', true);
        return { duration, update() {}, finish: () => h.setAlive(false) };
      }
      case 'overwatchSet': {
        const h = handleOf(event.unitId);
        if (!h) return null;
        const p = h.root.position;
        h.root.rotation.y = yawOf(event.direction.x, event.direction.z);
        showFloat('En garde', 'guard', p.x, p.y + FLOAT_HEIGHT_M, p.z);
        return { duration: GUARD_PAUSE_S, update() {}, finish() {} };
      }
      case 'turnStarted':
        return { duration: TURN_BANNER_S, update() {}, finish() {} };
      default:
        return null;
    }
  };

  // --- Pointer: hover preview and clicks --------------------------------------------------
  useEffect(() => {
    const el = gl.domElement;
    /** The structure an engine aims at under the pointer, with its preview. */
    const structureHover = (selectedId: string, typeKey: string, ground: Vec2 | null): { key: string; hover: HoverPreview } | null => {
      if (!ground || !isSiegeEngine(typeKey)) return null;
      const state = session.state;
      const def = structureAt(session.ctx, state, ground);
      if (!def) return null;
      const st = state.structures.find((s) => s.id === def.id);
      const result = previewStructureAttack(session.ctx, state, selectedId, def.id);
      return {
        key: `structure:${def.id}`,
        hover: result.ok ? { kind: 'structure', preview: result.preview, structure: def.kind, hp: st?.hp ?? 0, maxHp: def.maxHp } : { kind: 'blocked', reason: result.reason },
      };
    };
    const aim = (): { ground: Vec2 | null; unitId: string | null } => {
      const s = scratch.current;
      const r = el.getBoundingClientRect();
      s.ndc.set(((pointer.current.x - r.left) / r.width) * 2 - 1, -((pointer.current.y - r.top) / r.height) * 2 + 1);
      s.ray.setFromCamera(s.ndc, camera);
      let unitId: string | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const u of session.state.units) {
        if (!u.alive) continue;
        const h = handles?.get(u.id);
        if (!h) continue;
        s.p.copy(h.root.position);
        s.p.y += UNIT_PICK_HEIGHT_M / 2;
        const along = s.ray.ray.direction.dot(s.v.copy(s.p).sub(s.ray.ray.origin));
        const d = s.ray.ray.distanceToPoint(s.p);
        if (d < PICK_RADIUS_M + UNIT_PICK_HEIGHT_M / 2 && along > 0 && along < best) {
          best = along;
          unitId = u.id;
        }
      }
      const ground = groundHit(s.ray.ray, terrain, (x, z) => session.standHeight(x, z), s.ground) ? { x: s.ground.x, z: s.ground.z } : null;
      return { ground, unitId };
    };
    const refreshHover = () => {
      const ui = useBattleUi.getState();
      const state = session.state;
      const selected = ui.selectedId ? findUnit(state, ui.selectedId) : undefined;
      if (!pointer.current.inside || ui.busy || state.activeFaction !== PLAYER_FACTION || !selected?.alive) {
        if (hoverKey.current !== '') {
          hoverKey.current = '';
          ui.setHover({ kind: 'none' });
        }
        return;
      }
      const { ground, unitId } = aim();
      const target = unitId ? findUnit(state, unitId) : undefined;
      let key: string;
      let hover: HoverPreview;
      if (target && target.faction !== selected.faction) {
        key = `attack:${target.id}`;
        if (key === hoverKey.current) return;
        const result = previewAttack(session.ctx, state, selected.id, target.id);
        hover = result.ok ? { kind: 'attack', preview: result.preview } : { kind: 'blocked', reason: result.reason };
      } else if (!target && structureHover(selected.id, selected.typeKey, ground)) {
        const aimed = structureHover(selected.id, selected.typeKey, ground) as { key: string; hover: HoverPreview };
        key = aimed.key;
        if (key === hoverKey.current) return;
        hover = aimed.hover;
      } else if (ground && !target) {
        const cellKey = `move:${Math.floor(ground.x)},${Math.floor(ground.z)}`;
        key = cellKey;
        if (key === hoverKey.current) return;
        const result = planMove(session.ctx, state, selected.id, ground);
        hover = result.ok
          ? { kind: 'move', plan: result.plan, apLeft: selected.ap - result.plan.apSpent, threats: threatsAt(session.ctx, state, selected, result.plan.destination) }
          : { kind: 'blocked', reason: result.reason };
      } else {
        key = 'none';
        if (key === hoverKey.current) return;
        hover = { kind: 'none' };
      }
      hoverKey.current = key;
      ui.setHover(hover);
    };
    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX;
      pointer.current.y = e.clientY;
      pointer.current.inside = true;
      refreshHover();
    };
    const onLeave = () => {
      pointer.current.inside = false;
      refreshHover();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointer.current.down = true;
      pointer.current.downX = e.clientX;
      pointer.current.downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !pointer.current.down) return;
      pointer.current.down = false;
      if (Math.hypot(e.clientX - pointer.current.downX, e.clientY - pointer.current.downY) > CLICK_SLOP_PX) return;
      const ui = useBattleUi.getState();
      const state = session.state;
      if (ui.busy || state.activeFaction !== PLAYER_FACTION || state.status !== 'ongoing') return;
      const { ground, unitId } = aim();
      const clicked = unitId ? findUnit(state, unitId) : undefined;
      if (clicked && clicked.faction === PLAYER_FACTION) {
        // A second click on the selected unit recentres the camera on it.
        if (ui.selectedId === clicked.id) focusOn?.(clicked.position);
        ui.select(clicked.id);
        hoverKey.current = '';
        return;
      }
      const selected = ui.selectedId ? findUnit(state, ui.selectedId) : undefined;
      if (!selected?.alive) return;
      hoverKey.current = '';
      if (clicked) session.issue({ type: 'attack', unitId: selected.id, targetId: clicked.id });
      else if (ground && isSiegeEngine(selected.typeKey) && structureAt(session.ctx, state, ground)) {
        session.issue({ type: 'attackStructure', unitId: selected.id, structureId: (structureAt(session.ctx, state, ground) as StructureDef).id });
      } else if (ground) session.issue({ type: 'move', unitId: selected.id, to: ground });
    };
    const onKey = (e: KeyboardEvent) => {
      const ui = useBattleUi.getState();
      const state = session.state;
      if (e.code === 'Escape') {
        ui.select(null);
        hoverKey.current = '';
        return;
      }
      if (ui.busy || state.activeFaction !== PLAYER_FACTION || state.status !== 'ongoing') return;
      if (e.code === 'Tab') {
        // Next unit of ours still able to act (after the selected one, in id order).
        e.preventDefault();
        const ours = state.units.filter((u) => u.alive && u.faction === PLAYER_FACTION && (u.ap > 0 || u.actions > 0));
        if (ours.length === 0) return;
        const at = ours.findIndex((u) => u.id === ui.selectedId);
        const next = ours[(at + 1) % ours.length] as (typeof ours)[number];
        ui.select(next.id);
        focusOn?.(next.position);
        hoverKey.current = '';
        return;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        ui.select(null);
        session.issue({ type: 'endTurn' });
      } else if (e.code === 'KeyG' && ui.selectedId) {
        const selected = findUnit(state, ui.selectedId);
        const { ground } = aim();
        if (selected && ground) session.issue({ type: 'overwatch', unitId: selected.id, direction: { x: ground.x - selected.position.x, z: ground.z - selected.position.z } });
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    const unsubscribe = useBattleUi.subscribe((s, prev) => {
      if (s.selectedId !== prev.selectedId || s.busy !== prev.busy) {
        hoverKey.current = '';
        refreshHover();
      }
    });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      unsubscribe();
    };
  }, [gl, camera, session, handles, terrain, focusOn]);

  // --- Test hook (?e2e): drive and observe the battle from Playwright ----------------------
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('e2e')) return undefined;
    const toScreen = (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    window.__battle = {
      state: () => session.state,
      issue: (command) => session.issue(command),
      aiTurn: () => session.playAiTurn(session.state.activeFaction),
      busy: () => useBattleUi.getState().busy || queue.current.length > 0 || step.current !== null,
      unitScreen: (id) => {
        const h = handles?.get(id);
        return h ? toScreen(h.root.position.x, h.root.position.y + UNIT_PICK_HEIGHT_M / 2, h.root.position.z) : null;
      },
      groundScreen: (x, z) => toScreen(x, session.standHeight(x, z), z),
    };
    return () => {
      delete window.__battle;
    };
  }, [camera, gl, session, handles, terrain]);

  // --- Frame: play the queue, move floating texts, start the AI turn -----------------------
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1) * TIME_SCALE;
    let current = step.current;
    while (!current && queue.current.length > 0 && handles) {
      const next = makeStep(queue.current.shift() as GameEvent);
      if (next) current = step.current = { step: next, t: 0 };
    }
    if (current) {
      current.t += dt;
      current.step.update(Math.min(current.t, current.step.duration), dt);
      if (current.t >= current.step.duration) {
        current.step.finish();
        step.current = null;
      }
    } else if (queue.current.length === 0 && useBattleUi.getState().busy && !aiPending.current) {
      const state = session.state;
      if (state.status === 'ongoing' && state.activeFaction !== PLAYER_FACTION) {
        // Let the banner frame render before the AI (0.2–0.5 s on the main thread) runs.
        aiPending.current = true;
        window.setTimeout(() => {
          session.playAiTurn(state.activeFaction);
          aiPending.current = false;
        }, 0);
      } else useBattleUi.getState().setBusy(false);
    }

    const s = scratch.current;
    const r = gl.domElement.getBoundingClientRect();
    for (const f of floats.current) {
      if (f.age >= FLOAT_LIFE_S) continue;
      f.age += dt;
      if (f.age >= FLOAT_LIFE_S) {
        f.el.hidden = true;
        continue;
      }
      s.v.copy(f.at);
      s.v.y += (f.age / FLOAT_LIFE_S) * FLOAT_RISE_M;
      s.v.project(camera);
      f.el.style.transform = `translate(${((s.v.x + 1) / 2) * r.width}px, ${((1 - s.v.y) / 2) * r.height}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(1 - (f.age / FLOAT_LIFE_S) ** 2);
    }
  });

  return null;
}

/** Test hook installed with `?e2e` (Playwright drives and observes the battle through it). */
export interface BattleTestHook {
  state(): BattleState;
  issue(command: Command): unknown;
  /** The AI plays the active side's turn (tests drive both sides with it). */
  aiTurn(): void;
  /** Animations, queue or AI turn in progress. */
  busy(): boolean;
  /** Screen position (CSS px) of a unit's body, or null. */
  unitScreen(id: string): { x: number; y: number } | null;
  groundScreen(x: number, z: number): { x: number; y: number };
}

declare global {
  interface Window {
    __battle?: BattleTestHook;
  }
}
