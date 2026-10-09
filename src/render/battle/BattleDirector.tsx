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
import { Frustum, Matrix4, Raycaster, Vector2, Vector3, type Camera } from 'three';
import { previewAttack } from '../../core/battle/combat.ts';
import { distanceToCells, previewStructureAttack, SIEGE_ENGINE_TAG } from '../../core/battle/siege.ts';
import { structureDef, type StructureDef } from '../../core/battle/structures.ts';
import { fillCells, fillSurfaceM } from '../../core/battle/moat.ts';
import { MINE_SITE_PREFIX } from '../../core/battle/siege-works.ts';
import { projectOnPolyline } from '../../core/worldgen/geometry.ts';
import { sampleHeight } from '../../core/terrain-data/terrain-data.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import type { CastleHandle, CastleWork } from '../castle/Castle.tsx';
import type { FireHandle } from '../vfx/Fire.tsx';
import type { ProjectileHandle } from '../vfx/Projectiles.tsx';
import { INDIRECT_FIRE_TAG } from '../../core/battle/combat.ts';
import { findUnit, planMove } from '../../core/battle/movement.ts';
import type { BattleState } from '../../core/battle/types.ts';
import type { Command } from '../../core/commands/types.ts';
import { threatsAt } from '../../core/battle/overwatch.ts';
import type { GameEvent } from '../../core/events/types.ts';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { TerrainLayer } from '../../core/rules/types.ts';
import { useBattleUi, type HoverPreview } from '../../state/battle-ui.ts';
import { PLAYER_FACTION, type BattleSession } from '../../ui/battle/session.ts';
import { describeEvent } from '../../ui/battle/describe.ts';
import { requestEndTurn } from '../../ui/battle/end-turn.ts';
import { actionCommand, actionPreview, aimsAtAllies, structureAt, triggerAction, type ActionId } from '../../ui/battle/actions.ts';
import { audio, type SoundId } from '../../audio/engine.ts';
import { useSettings } from '../../state/settings.ts';
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
/** Footsteps every so often while walking, running; an engine's wheels creak more slowly (s). */
const STEP_WALK_S = 0.45;
const STEP_RUN_S = 0.32;
const ENGINE_ROLL_S = 1.0;
/** Quieter sounds: a miss, a parried blow, a spreading fire. */
const SOFT = 0.5;
/** Shortcut keys of the card's actions (ui/battle/actions.ts shows them on its buttons). */
const ACTION_KEYS: Readonly<Record<string, string>> = {
  KeyG: 'guard',
  KeyB: 'fireArrow',
  KeyE: 'extinguish',
  KeyF: 'works',
  Digit1: 'ability:0',
  Numpad1: 'ability:0',
  Digit2: 'ability:1',
  Numpad2: 'ability:1',
};
/** A hero's ability: the pause on its name. */
const ABILITY_PAUSE_S = 0.7;
const TURN_BANNER_S = 0.9;
/** The enemy's turn plays this much faster; its walks out of view, this much. */
const ENEMY_SPEED = 1.8;
const OUT_OF_VIEW_SPEED = 12;
/** Pointer travel (px) above which a press is a drag, not a click. */
const CLICK_SLOP_PX = 6;
/** Ray march along the view ray over the heightfield (m). */
const RAY_STEP_M = 1;
const RAY_MAX_M = 900;
/** A unit is under the pointer when the ray passes this close to its axis (m). */
const PICK_RADIUS_M = 0.8;
const UNIT_PICK_HEIGHT_M = 2.2;
/** Shots: release heights above the shooter's feet, where they strike a body, how far a miss lands (m). */
const BOW_HEIGHT_M = 1.5;
const CATAPULT_RELEASE_M = 3.2;
const BODY_AIM_M = 1.1;
const MISS_OFFSET_M: readonly [number, number] = [1.2, 2.6];
/** A catapult stone strikes this far below a segment's text anchor (the wall face). */
const STRUCTURE_FACE_DROP_M = 4;
const FIRE_ARROW_AIM_M = 0.6;
/** A beat after a projectile lands before the next event. */
const LANDING_PAUSE_S = 0.2;
/** Climbing a docked tower: walk to its foot, rise inside it, step onto the wall-walk (s). */
const CLIMB_WALK_S = 0.6;
const CLIMB_RISE_S = 1.1;
const CLIMB_STEP_S = 0.5;
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

/** How the castle should show a sappers' work at `fraction` of its turns. */
function castleWork(session: BattleSession, workId: string, kind: 'fill' | 'mine', fraction: number, sapper: Vec2): CastleWork | null {
  const ctx = session.ctx;
  if (kind === 'fill') {
    const cells = fillCells(ctx, workId).map((i) => ({ x: (i % ctx.nav.width) + 0.5, z: Math.floor(i / ctx.nav.width) + 0.5 }));
    const moat = ctx.moats.find((m) => workId.includes(`:${m.id}:`));
    if (!moat || cells.length === 0) return null;
    const mid = cells.reduce((a, c) => ({ x: a.x + c.x / cells.length, z: a.z + c.z / cells.length }), { x: 0, z: 0 });
    // The moat's direction at the slot: its centreline segment nearest to the slot's middle.
    let best = Number.POSITIVE_INFINITY;
    let tangent = { x: 1, z: 0 };
    for (let i = 0; i < moat.centerline.length - 1; i++) {
      const sa = moat.centerline[i] as Vec2;
      const sb = moat.centerline[i + 1] as Vec2;
      const d = projectOnPolyline(mid, [sa, sb]).distance;
      const len = Math.hypot(sb.x - sa.x, sb.z - sa.z);
      if (d < best && len > 0) {
        best = d;
        tangent = { x: (sb.x - sa.x) / len, z: (sb.z - sa.z) / len };
      }
    }
    const bed = cells.reduce((m, c) => Math.min(m, sampleHeight(ctx.terrain, c.x, c.z)), Number.POSITIVE_INFINITY);
    return { kind: 'fill', id: workId, fraction, cells, tangent, surfaceM: fillSurfaceM(ctx, workId), bedM: bed };
  }
  const def = structureDef(ctx, workId.slice(MINE_SITE_PREFIX.length));
  if (!def) return null;
  const dx = sapper.x - def.center.x;
  const dz = sapper.z - def.center.z;
  const len = Math.hypot(dx, dz) || 1;
  return { kind: 'mine', id: workId, fraction, at: sapper, out: { x: dx / len, z: dz / len }, groundM: session.standHeight(sapper.x, sapper.z), wallM: distanceToCells(ctx, def.cells, sapper) };
}

/** Footstep sound for the ground at (x, z): timber decks, stone walks, roads, grass. */
function surfaceSound(session: BattleSession, x: number, z: number): SoundId {
  const t = session.ctx.terrain;
  const cell = Math.floor(z) * t.width + Math.floor(x);
  const layer = session.ctx.nav.terrain.layers[cell];
  if (layer === TerrainLayer.Bridge || layer === TerrainLayer.Fascine) return 'step_wood';
  if ((session.ctx.nav.deck[cell] ?? 0) > 0 || layer === TerrainLayer.Rampart || layer === TerrainLayer.Stair || layer === TerrainLayer.Rubble) return 'step_stone';
  if (layer === TerrainLayer.Road || layer === TerrainLayer.Mud || layer === TerrainLayer.Ford) return 'step_dirt';
  return 'step_grass';
}

/** The sound of a blow landing: arrows by the target's armour, a stone, a blade or a mace. */
function blowSound(ranged: boolean, lob: boolean, attackType: string, targetType: string, hit: boolean): SoundId {
  if (lob) return 'blunt_hit';
  const armor = DEFAULT_RULES.units[targetType]?.armor ?? 'light';
  if (ranged) return !hit ? 'arrow_hit_wood' : armor === 'heavy' || armor === 'medium' ? 'hit_metal' : 'arrow_hit_flesh';
  return attackType === 'blunt' ? 'blunt_hit' : 'sword_clash';
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
  fire = null,
  projectiles = null,
  terrain,
  focusOn,
}: {
  readonly session: BattleSession;
  readonly handles: ReadonlyMap<string, UnitHandle> | null;
  /** The castle's siege handle (structures), once the castle is built. */
  readonly castle?: CastleHandle | null;
  /** The fires' handle. */
  readonly fire?: FireHandle | null;
  /** Arrows, bolts and stones in flight. */
  readonly projectiles?: ProjectileHandle | null;
  readonly terrain: TerrainData;
  /** Recentres the camera (Tab, double-click on a unit of ours). */
  readonly focusOn?: (p: Vec2) => void;
}) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as Camera;
  /** Events to play, each with whether the enemy's turn produced it (it plays quicker). */
  const queue = useRef<{ event: GameEvent; enemy: boolean }[]>([]);
  const step = useRef<{ step: Step; t: number; speed: number; type: GameEvent['type'] } | null>(null);
  const lastSpeed = useRef(1);
  const lastType = useRef<GameEvent['type']>('turnStarted');
  const frustum = useRef({ f: new Frustum(), m: new Matrix4(), p: new Vector3() });
  /** Is the ground point in view (the enemy's moves out of view play at once)? */
  const inView = (x: number, z: number): boolean => {
    const v = frustum.current;
    v.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    v.f.setFromProjectionMatrix(v.m);
    return v.f.containsPoint(v.p.set(x, session.standHeight(x, z), z));
  };
  /** How fast an event of the enemy's turn plays: quicker, its walks out of view at once. */
  const speedOf = (event: GameEvent): number => {
    if (event.type === 'unitMoved') {
      const a = event.path[0];
      const b = event.path[event.path.length - 1];
      if (a && b && !inView(a.x, a.z) && !inView(b.x, b.z)) return OUT_OF_VIEW_SPEED;
    }
    return ENEMY_SPEED;
  };
  const floats = useRef<FloatText[]>([]);
  const scratch = useRef({ v: new Vector3(), ground: new Vector3(), ndc: new Vector2(), ray: new Raycaster(), p: new Vector3(), aim: new Vector3(), launch: new Vector3(), landing: new Vector3() });
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
      // The enemy's turn arrives as one batch, closed by its own end of turn.
      const enemy = events.some((e) => e.type === 'turnEnded' && e.faction !== PLAYER_FACTION);
      queue.current.push(...events.map((event) => ({ event, enemy })));
      const store = useBattleUi.getState();
      store.setBattle(state);
      const lines = events.map((e) => describeEvent(e, state)).filter((l): l is string => l !== null);
      if (lines.length > 0) store.pushLog(lines);
      if (events.some((e) => e.type === 'commandRejected')) audio.play('ui_click');
      const ending = events.find((e) => e.type === 'battleEnded');
      if (ending) store.setEnding(ending);
      // Any order given disarms the end-of-turn warning.
      if (store.endTurnArmed && events.some((e) => e.type !== 'commandRejected')) store.armEndTurn(false);
      // The first order given closes the opening briefing.
      if (!store.briefed && events.some((e) => e.type !== 'commandRejected')) store.setBriefed();
      if (events.length > 0) store.setBusy(true);
    });
  }, [session]);

  const handleOf = (id: string) => handles?.get(id) ?? null;

  /** A shot from `from` (a unit's feet) to a point; returns its flight time (0 without projectiles). */
  const shootAt = (lob: boolean, from: Vector3, to: Vector3, hit: boolean, seedKey: string, burning: boolean): number => {
    if (!projectiles) return 0;
    const s = scratch.current;
    s.launch.copy(from);
    s.launch.y += lob ? CATAPULT_RELEASE_M : BOW_HEIGHT_M;
    s.landing.copy(to);
    if (!hit) {
      // A miss lands beside the target, on the ground.
      let h = 0;
      for (let i = 0; i < seedKey.length; i++) h = (Math.imul(h, 31) + seedKey.charCodeAt(i)) | 0;
      const a = ((h >>> 0) % 360) * (Math.PI / 180);
      const r = MISS_OFFSET_M[0] + (((h >>> 9) % 100) / 100) * (MISS_OFFSET_M[1] - MISS_OFFSET_M[0]);
      s.landing.x += Math.cos(a) * r;
      s.landing.z += Math.sin(a) * r;
      s.landing.y = session.standHeight(s.landing.x, s.landing.z);
    }
    return lob ? projectiles.stone(s.launch, s.landing, null) : projectiles.arrow(s.launch, s.landing, burning, null);
  };
  /** A shot at a unit's body. */
  const shoot = (lob: boolean, from: Vector3, target: Vector3, hit: boolean, seedKey: string, burning: boolean): number => {
    const aim = scratch.current.aim.copy(target);
    aim.y += BODY_AIM_M;
    return shootAt(lob, from, aim, hit, seedKey, burning);
  };

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
        const stepEvery = engine ? ENGINE_ROLL_S : run ? STEP_RUN_S : STEP_WALK_S;
        let nextStep = 0;
        if (engine) audio.play('engine_creak', { at: h.root.position });
        return {
          duration: total / speed,
          update(t, dt) {
            if (t >= nextStep) {
              nextStep = t + stepEvery;
              audio.play(engine ? 'engine_roll' : surfaceSound(session, h.root.position.x, h.root.position.z), { at: h.root.position });
            }
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
        const release = Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip)) * IMPACT_AT;
        const facing = yawOf(target.root.position.x - attacker.root.position.x, target.root.position.z - attacker.root.position.z);
        const type = DEFAULT_RULES.units[findUnit(session.state, event.attackerId)?.typeKey ?? ''];
        const ranged = !event.riposte && (type?.attack?.rangeM ?? 0) > 0;
        const lob = type?.tags.includes(INDIRECT_FIRE_TAG) ?? false;
        let released = false;
        let landAt = Number.POSITIVE_INFINITY;
        let landed = false;
        const step: Step = {
          duration: Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip)),
          update(t, dt) {
            attacker.root.rotation.y = approachAngle(attacker.root.rotation.y, facing, TURN_RATE * dt);
            if (!released && t >= release) {
              released = true;
              if (ranged) audio.play(lob ? 'catapult_release' : type?.tags.includes('slowReload') ? 'crossbow_shot' : 'bow_shot', { at: attacker.root.position });
              // Shots fly to the target (or beside it when they miss); blows land at once.
              const flight = ranged ? shoot(lob, attacker.root.position, target.root.position, event.hit, event.attackerId + event.targetId, false) : 0;
              landAt = t + flight;
              step.duration = Math.max(step.duration, landAt + LANDING_PAUSE_S);
            }
            if (!landed && t >= landAt) {
              landed = true;
              const p = target.root.position;
              audio.play(blowSound(ranged, lob, type?.attack?.type ?? 'blunt', findUnit(session.state, event.targetId)?.typeKey ?? '', event.hit), { at: p, volume: event.hit ? 1 : SOFT });
              if (event.hit && event.hpAfter === 0) audio.play('hurt', { at: p });
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
        return step;
      }
      case 'structureDamaged': {
        const attacker = handleOf(event.attackerId);
        const def = structureDef(session.ctx, event.structureId);
        if (!def) return null;
        const clip = attacker ? attacker.play('attack', true) : ATTACK_DURATION_S[0];
        const release = Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip)) * IMPACT_AT;
        const facing = attacker ? yawOf(def.center.x - attacker.root.position.x, def.center.z - attacker.root.position.z) : 0;
        const type = DEFAULT_RULES.units[findUnit(session.state, event.attackerId)?.typeKey ?? ''];
        const lob = type?.tags.includes(INDIRECT_FIRE_TAG) ?? false;
        let released = false;
        let landAt = Number.POSITIVE_INFINITY;
        let landed = false;
        const step: Step = {
          duration: Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip)),
          update(t, dt) {
            if (attacker) attacker.root.rotation.y = approachAngle(attacker.root.rotation.y, facing, TURN_RATE * dt);
            if (!released && t >= release) {
              released = true;
              // The catapult's stone strikes the wall face; the ram's blow lands at once.
              if (lob && attacker) {
                audio.play('catapult_release', { at: attacker.root.position });
                audio.play('engine_creak', { at: attacker.root.position, volume: SOFT });
              }
              let flight = 0;
              const aim = scratch.current.aim;
              if (lob && attacker && castle?.anchorOf(event.structureId, aim)) {
                aim.y -= STRUCTURE_FACE_DROP_M;
                flight = shootAt(true, attacker.root.position, aim, event.hit, event.attackerId + event.structureId + event.hpAfter, false);
              }
              landAt = t + flight;
              step.duration = Math.max(step.duration, landAt + LANDING_PAUSE_S);
            }
            if (!landed && t >= landAt) {
              landed = true;
              if (event.hit) castle?.hit(event.structureId, def.maxHp > 0 ? event.hpAfter / def.maxHp : 1);
              audio.play(lob ? (event.hit ? 'stone_hit_wall' : 'rubble') : 'ram_hit', { at: def.center, volume: event.hit ? 1 : SOFT });
              const p = scratch.current.p;
              if (castle?.anchorOf(event.structureId, p)) showFloat(event.hit ? `${event.crit ? 'Critique ! ' : ''}−${event.damage}` : 'Raté', event.hit ? (event.crit ? 'crit' : 'hit') : 'miss', p.x, p.y, p.z);
            }
          },
          finish() {
            attacker?.play('idle');
          },
        };
        return step;
      }
      case 'structureBroken': {
        const duration = castle?.bringDown(event.structureId) ?? 0;
        const where = structureDef(session.ctx, event.structureId)?.center;
        const fall: SoundId = event.kind === 'wall' ? 'rubble' : 'drawbridge_fall';
        let thud = event.kind !== 'wall' && event.kind !== 'drawbridge';
        if (where) audio.play(event.kind === 'wall' ? 'wall_collapse' : event.kind === 'gate' ? 'gate_break' : event.kind === 'portcullis' ? 'portcullis' : 'chain', { at: where });
        // Units on a collapsing wall-walk come down with it (their deaths follow as events).
        const falling = event.fallen
          .map((f) => ({ f, h: handleOf(f.unitId) }))
          .filter((x): x is { f: (typeof event.fallen)[number]; h: UnitHandle } => x.h !== null)
          .map(({ f, h }) => ({ f, h, from: h.root.position.y, to: session.standHeight(h.root.position.x, h.root.position.z) }));
        for (const { f, h } of falling) if (f.hpAfter > 0) h.play('hit', true);
        return {
          duration: Math.max(duration, TURN_BANNER_S),
          update(t) {
            // The drawbridge slams down at the end of its fall; rubble settles after a collapse.
            if (!thud && t >= duration * FALL_FRACTION) {
              thud = true;
              if (where) audio.play(fall, { at: where });
            }
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
      case 'siegeWorkProgressed': {
        const h = handleOf(event.unitId);
        const unit = findUnit(session.state, event.unitId);
        const duration = h ? Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], h.play('attack', true))) : ATTACK_DURATION_S[0];
        let done = false;
        return {
          duration,
          update(t) {
            if (done || t < duration * IMPACT_AT || !unit) return;
            done = true;
            audio.play('dig', { at: unit.position });
            const work = castleWork(session, event.workId, event.kind, event.progress / event.required, unit.position);
            if (work) castle?.setWork(work);
            const p = h?.root.position;
            if (p) showFloat(`${event.kind === 'fill' ? 'Fascines' : 'Sape'} ${event.progress}/${event.required}`, 'work', p.x, p.y + FLOAT_HEIGHT_M, p.z);
          },
          finish() {
            h?.play('idle');
          },
        };
      }
      case 'towerDocked': {
        const h = handleOf(event.towerId);
        if (h) {
          audio.play('chain', { at: h.root.position });
          audio.play('drawbridge_fall', { at: h.root.position });
        }
        const duration = h ? h.play('attack', true) : 0;
        return { duration: Math.max(duration, GUARD_PAUSE_S), update() {}, finish() {} };
      }
      case 'unitClimbed': {
        const h = handleOf(event.unitId);
        const tower = handleOf(event.towerId);
        if (!h) return null;
        const base = tower ? { x: tower.root.position.x, z: tower.root.position.z } : event.from;
        const y0 = h.root.position.y;
        const yTop = session.standHeight(event.to.x, event.to.z);
        const fromX = h.root.position.x;
        const fromZ = h.root.position.z;
        h.play('walk');
        return {
          duration: CLIMB_WALK_S + CLIMB_RISE_S + CLIMB_STEP_S,
          update(t) {
            if (t < CLIMB_WALK_S) {
              const k = t / CLIMB_WALK_S;
              h.root.position.set(fromX + (base.x - fromX) * k, y0, fromZ + (base.z - fromZ) * k);
            } else if (t < CLIMB_WALK_S + CLIMB_RISE_S) {
              const k = (t - CLIMB_WALK_S) / CLIMB_RISE_S;
              h.root.position.set(base.x, y0 + (yTop - y0) * k, base.z);
            } else {
              const k = Math.min(1, (t - CLIMB_WALK_S - CLIMB_RISE_S) / CLIMB_STEP_S);
              h.root.position.set(base.x + (event.to.x - base.x) * k, yTop, base.z + (event.to.z - base.z) * k);
              h.root.rotation.y = yawOf(event.to.x - base.x, event.to.z - base.z);
            }
          },
          finish() {
            h.root.position.set(event.to.x, yTop, event.to.z);
            h.play('idle');
          },
        };
      }
      case 'fireArrowShot': {
        const h = handleOf(event.unitId);
        const clip = h ? h.play('attack', true) : ATTACK_DURATION_S[0];
        const release = Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip)) * IMPACT_AT;
        const facing = h ? yawOf(event.at.x - h.root.position.x, event.at.z - h.root.position.z) : 0;
        let released = false;
        let landAt = Number.POSITIVE_INFINITY;
        let landed = false;
        const step: Step = {
          duration: Math.min(ATTACK_DURATION_S[1], Math.max(ATTACK_DURATION_S[0], clip)),
          update(t, dt) {
            if (h) h.root.rotation.y = approachAngle(h.root.rotation.y, facing, TURN_RATE * dt);
            if (!released && t >= release) {
              released = true;
              const aim = scratch.current.aim.set(event.at.x, session.standHeight(event.at.x, event.at.z) + FIRE_ARROW_AIM_M, event.at.z);
              if (h) audio.play('bow_shot', { at: h.root.position });
              const flight = h ? shootAt(false, h.root.position, aim, true, event.unitId, true) : 0;
              landAt = t + flight;
              step.duration = Math.max(step.duration, landAt + LANDING_PAUSE_S);
            }
            if (landed || t < landAt) return;
            landed = true;
            if (event.caught) fire?.syncFrom(session.state);
            if (event.caught) audio.play('fire_ignite', { at: event.at });
            showFloat(event.caught ? 'Ça prend !' : 'Éteinte', event.caught ? 'crit' : 'miss', event.at.x, session.standHeight(event.at.x, event.at.z) + 1.2, event.at.z);
          },
          finish() {
            h?.play('idle');
          },
        };
        return step;
      }
      case 'fireStarted':
      case 'fireOut': {
        fire?.syncFrom(session.state);
        const cell = event.cells[0];
        if (cell !== undefined) {
          const at = { x: (cell % terrain.width) + 0.5, z: Math.floor(cell / terrain.width) + 0.5 };
          if (event.type === 'fireStarted') audio.play('fire_ignite', { at, volume: SOFT });
          else if (event.byId) audio.play('splash', { at, volume: SOFT });
        }
        return null;
      }
      case 'unitBurned': {
        const h = handleOf(event.unitId);
        if (!h) return null;
        audio.play('hurt', { at: h.root.position, volume: SOFT });
        if (event.hpAfter > 0) h.play('hit', true);
        const p = h.root.position;
        showFloat(`−${event.damage}`, 'crit', p.x, p.y + FLOAT_HEIGHT_M, p.z);
        return { duration: GUARD_PAUSE_S, update() {}, finish: () => (event.hpAfter > 0 ? h.play('idle') : undefined) };
      }
      case 'structureBurned': {
        const def = structureDef(session.ctx, event.structureId);
        castle?.hit(event.structureId, def && def.maxHp > 0 ? event.hpAfter / def.maxHp : 1);
        const p = scratch.current.p;
        if (castle?.anchorOf(event.structureId, p)) showFloat(`−${event.damage}`, 'crit', p.x, p.y, p.z);
        return { duration: GUARD_PAUSE_S, update() {}, finish() {} };
      }
      case 'unitDied': {
        const h = handleOf(event.unitId);
        if (!h) return null;
        const duration = h.play('death', true);
        return { duration, update() {}, finish: () => h.setAlive(false) };
      }
      case 'abilityUsed': {
        const h = handleOf(event.unitId);
        if (!h) return null;
        audio.play('ui_confirm');
        const hero = DEFAULT_RULES.heroes[findUnit(session.state, event.unitId)?.typeKey ?? ''];
        const ability = hero?.abilities.find((a) => a.id === event.abilityId);
        const p = h.root.position;
        h.play('attack', true);
        showFloat(`${ability?.name ?? event.abilityId} !`, 'crit', p.x, p.y + FLOAT_HEIGHT_M + 0.4, p.z);
        if (ability && (ability.target === 'self' || ability.target === 'allyEngine')) {
          for (const id of event.affected) {
            if (id === event.unitId) continue;
            const t = handleOf(id)?.root.position;
            if (t) showFloat(ability.id === 'rally' ? `+${ability.moraleGain} moral` : `+${Math.round(ability.accuracyBonus * 100)} %`, 'guard', t.x, t.y + FLOAT_HEIGHT_M, t.z);
          }
        }
        return {
          duration: ABILITY_PAUSE_S,
          update() {},
          finish() {
            h.play('idle');
          },
        };
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
        audio.play(event.faction === PLAYER_FACTION ? 'turn_horn' : 'turn_bell');
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
      const armedId = ui.armedAction as ActionId | null;
      if (armedId) {
        // The armed action, aimed here (keyed by its order: one preview per distinct order).
        const command = actionCommand(session, selected, armedId, target, ground);
        key = `action:${armedId}:${command ? JSON.stringify(command, (k, v: unknown) => (typeof v === 'number' && k !== 'turn' ? Math.floor(v) : v)) : 'none'}`;
        if (key === hoverKey.current) return;
        hover = actionPreview(session, selected, armedId, target, ground);
      } else if (target && target.faction !== selected.faction) {
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
      const armedBy = ui.selectedId ? findUnit(state, ui.selectedId) : undefined;
      const aimingAlly = ui.armedAction !== null && armedBy !== undefined && aimsAtAllies(armedBy, ui.armedAction as ActionId);
      if (clicked && clicked.faction === PLAYER_FACTION && !aimingAlly) {
        // A second click on the selected unit recentres the camera on it.
        if (ui.selectedId === clicked.id) focusOn?.(clicked.position);
        ui.select(clicked.id);
        hoverKey.current = '';
        return;
      }
      const selected = ui.selectedId ? findUnit(state, ui.selectedId) : undefined;
      if (!selected?.alive) return;
      hoverKey.current = '';
      if (ui.armedAction) {
        const command = actionCommand(session, selected, ui.armedAction as ActionId, clicked, ground);
        if (command) {
          ui.armAction(null);
          session.issue(command);
        }
        return;
      }
      if (clicked) session.issue({ type: 'attack', unitId: selected.id, targetId: clicked.id });
      else if (ground && isSiegeEngine(selected.typeKey) && structureAt(session.ctx, state, ground)) {
        session.issue({ type: 'attackStructure', unitId: selected.id, structureId: (structureAt(session.ctx, state, ground) as StructureDef).id });
      } else if (ground) session.issue({ type: 'move', unitId: selected.id, to: ground });
    };
    const onKey = (e: KeyboardEvent) => {
      const ui = useBattleUi.getState();
      const state = session.state;
      if (e.code === 'KeyM') {
        const settings = useSettings.getState();
        settings.setMuted(!settings.muted);
        return;
      }
      if (e.code === 'Escape') {
        if (ui.armedAction) ui.armAction(null);
        else ui.select(null);
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
        requestEndTurn(session);
      } else if (ACTION_KEYS[e.code] && ui.selectedId) {
        // The card's actions: armed (the pointer aims them) or ordered at once.
        triggerAction(session, ACTION_KEYS[e.code] as ActionId);
        hoverKey.current = '';
        refreshHover();
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    const unsubscribe = useBattleUi.subscribe((s, prev) => {
      if (s.selectedId && s.selectedId !== prev.selectedId) audio.play('ui_select');
      if (s.selectedId !== prev.selectedId || s.busy !== prev.busy || s.armedAction !== prev.armedAction) {
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
      playing: () => (step.current ? { type: step.current.type, t: step.current.t, duration: step.current.step.duration } : null),
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
      const { event, enemy } = queue.current.shift() as { event: GameEvent; enemy: boolean };
      lastSpeed.current = enemy ? speedOf(event) : 1;
      lastType.current = event.type;
      const next = makeStep(event);
      if (next) current = step.current = { step: next, t: 0, speed: lastSpeed.current, type: lastType.current };
    }
    if (current) {
      current.t += dt * current.speed;
      current.step.update(Math.min(current.t, current.step.duration), dt);
      if (current.t >= current.step.duration) {
        current.step.finish();
        step.current = null;
      }
    } else if (queue.current.length === 0 && useBattleUi.getState().busy && !aiPending.current) {
      const state = session.state;
      if (state.status === 'ongoing' && state.activeFaction !== PLAYER_FACTION) {
        // The AI plans in its worker (the picture keeps moving), then its orders play out.
        aiPending.current = true;
        void session.playAiTurnAsync(state.activeFaction).then(() => {
          aiPending.current = false;
        });
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
  /** The event being played, its time and duration (s), or null (captures wait on it). */
  playing(): { type: string; t: number; duration: number } | null;
  /** Screen position (CSS px) of a unit's body, or null. */
  unitScreen(id: string): { x: number; y: number } | null;
  groundScreen(x: number, z: number): { x: number; y: number };
}

declare global {
  interface Window {
    __battle?: BattleTestHook;
  }
}
