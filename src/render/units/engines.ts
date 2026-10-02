/**
 * Siege engines on the battlefield (J4): the vertex-coloured models of
 * scripts/blender/build_siege_engines.py — one skinned mesh per engine (one draw call), each part
 * rigidly bound to a bone whose head is its pivot and whose rest frame is the model's — animated in
 * code — wheels roll while the engine moves, the catapult's arm swings up to its stop and is
 * wound back, the ram's log is drawn back and driven forward, a hit shakes the frame and a
 * destroyed engine slumps on its side. Same handle contract as the characters (UnitHandle).
 */
import { Bone, Group, SkinnedMesh, type Material, type Object3D } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { UnitClip } from './Units.tsx';

export const ENGINE_MODELS = { ram: '/assets/engines/ram.glb', catapult: '/assets/engines/catapult.glb' } as const;
export type EngineKind = keyof typeof ENGINE_MODELS;

/** Height (m) of each engine's top: pennants fly above it. */
export const ENGINE_HEIGHT_M: Readonly<Record<EngineKind, number>> = { ram: 3.4, catapult: 2.8 };

export function engineKindOf(typeKey: string): EngineKind | null {
  return typeKey in ENGINE_MODELS ? (typeKey as EngineKind) : null;
}

/** Rolling speed (m/s) the director moves engines at; the wheels turn to match. */
export const ENGINE_SPEED_MS = 1.4;
const WHEEL_RADIUS_M: Readonly<Record<EngineKind, number>> = { ram: 0.55, catapult: 0.5 };
/** Catapult: the arm swings up to its stop (rad about the axle), then is wound back down. */
const ARM_FIRED_RAD = 1.85;
const ARM_RELEASE_S = 0.22;
const ARM_HOLD_S = 0.35;
const ARM_REWIND_S = 1.2;
/** Ram: drawn back, driven forward, settled (m along its axis). */
const LOG_BACK_M = -0.7;
const LOG_DRIVE_M = 0.95;
const LOG_DRAW_S = 0.5;
const LOG_DRIVE_S = 0.14;
const LOG_SETTLE_S = 0.6;
const SHAKE_S = 0.35;
const SHAKE_RAD = 0.04;
const WRECK_S = 1.1;
const WRECK_TILT_RAD = 0.42;
const WRECK_SINK_M = 0.35;

export interface EngineRig {
  /** Holds the model; shaken and tilted by the clips (the unit root stays where the director puts it). */
  readonly pose: Group;
  play(clip: UnitClip, once: boolean): number;
  update(dt: number): void;
  setSilhouette(on: boolean): void;
}

const easeOut = (k: number) => 1 - (1 - k) * (1 - k);

export function createEngineRig(source: Object3D, kind: EngineKind, material: Material, silhouette: Material, silhouetteOrder: number): EngineRig {
  const model = cloneSkinned(source);
  const meshes: SkinnedMesh[] = [];
  const bones = new Map<string, Bone>();
  model.traverse((o) => {
    if (o instanceof Bone) bones.set(o.name, o);
    if (!(o instanceof SkinnedMesh)) return;
    o.material = material;
    o.castShadow = true;
    o.receiveShadow = true;
    // The rest bounds do not follow the bones (the arm swings above them).
    o.frustumCulled = false;
    meshes.push(o);
  });
  const wheels = [...bones.values()].filter((b) => b.name.startsWith('Wheel'));
  const arm = bones.get('Arm') ?? null;
  const log = bones.get('Log') ?? null;
  const logRest = log ? log.position.z : 0;
  const pose = new Group();
  pose.add(model);

  let rolling = false;
  // One clip at a time drives the moving part; t counts its seconds.
  let action: { clip: UnitClip; t: number; duration: number } | null = null;
  let wrecked = false;
  let ghosts: SkinnedMesh[] | null = null;

  const actionDuration = (clip: UnitClip): number => {
    if (clip === 'attack') return kind === 'catapult' ? ARM_RELEASE_S + ARM_HOLD_S + ARM_REWIND_S : LOG_DRAW_S + LOG_DRIVE_S + LOG_SETTLE_S;
    if (clip === 'hit') return SHAKE_S;
    if (clip === 'death') return WRECK_S;
    return 0;
  };

  return {
    pose,
    play(clip) {
      if (wrecked) return 0;
      rolling = clip === 'walk' || clip === 'run';
      const duration = actionDuration(clip);
      action = duration > 0 ? { clip, t: 0, duration } : null;
      return duration;
    },
    update(dt) {
      if (rolling) for (const w of wheels) w.rotation.x += (ENGINE_SPEED_MS / WHEEL_RADIUS_M[kind]) * dt;
      if (!action) return;
      action.t = Math.min(action.duration, action.t + dt);
      const t = action.t;
      if (action.clip === 'attack' && arm) {
        if (t < ARM_RELEASE_S) arm.rotation.x = ARM_FIRED_RAD * easeOut(t / ARM_RELEASE_S);
        else if (t < ARM_RELEASE_S + ARM_HOLD_S) arm.rotation.x = ARM_FIRED_RAD;
        else arm.rotation.x = ARM_FIRED_RAD * (1 - (t - ARM_RELEASE_S - ARM_HOLD_S) / ARM_REWIND_S);
      } else if (action.clip === 'attack' && log) {
        let z: number;
        if (t < LOG_DRAW_S) z = LOG_BACK_M * easeOut(t / LOG_DRAW_S);
        else if (t < LOG_DRAW_S + LOG_DRIVE_S) z = LOG_BACK_M + (LOG_DRIVE_M - LOG_BACK_M) * ((t - LOG_DRAW_S) / LOG_DRIVE_S);
        else z = LOG_DRIVE_M * (1 - easeOut((t - LOG_DRAW_S - LOG_DRIVE_S) / LOG_SETTLE_S));
        log.position.z = logRest + z;
      } else if (action.clip === 'hit') {
        pose.rotation.z = SHAKE_RAD * Math.sin((t / SHAKE_S) * Math.PI * 4) * (1 - t / SHAKE_S);
      } else if (action.clip === 'death') {
        const k = easeOut(t / WRECK_S);
        pose.rotation.z = WRECK_TILT_RAD * k;
        pose.position.y = -WRECK_SINK_M * k;
        if (t >= WRECK_S) wrecked = true;
      }
      if (t >= action.duration) action = null;
    },
    setSilhouette(on) {
      if (!ghosts) {
        if (!on) return;
        ghosts = meshes.map((m) => {
          const ghost = new SkinnedMesh(m.geometry, silhouette);
          ghost.bind(m.skeleton, m.bindMatrix);
          ghost.renderOrder = silhouetteOrder;
          ghost.frustumCulled = false;
          m.parent?.add(ghost);
          return ghost;
        });
      }
      for (const g of ghosts) g.visible = on;
    },
  };
}
