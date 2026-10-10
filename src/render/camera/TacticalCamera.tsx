/**
 * Tactical camera (brief §8): orbit around a ground focus, damped. Physical key codes
 * (KeyW/A/S/D = ZQSD on AZERTY, arrows), screen-edge scrolling, wheel zoom, Q/E (A/E on
 * AZERTY) or middle-drag rotation. Pitch follows zoom inside a limited band; the camera never
 * dips under the relief. Publishes the focus to the painted globals (fog, grass radius, shadows).
 * A battle may open on an establishing shot: held on the castle, then a glide to the army; any
 * input or new view cuts it short.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MathUtils, Vector3 } from 'three';
import type { Vec2 } from '../../core/math/vec2.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { paintedGlobals, updateFogForCamera } from '../materials/painted-globals.ts';
import { CAMERA_SPEEDS, useSettings } from '../../state/settings.ts';

export interface CameraView {
  readonly focus: Vec2;
  readonly distance: number;
  /** Turns, 0 = looking towards -z. */
  readonly yawTurns: number;
  /** Degrees above the horizon. */
  readonly pitchDeg: number;
}

export interface CameraLimits {
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minPitchDeg: number;
  readonly maxPitchDeg: number;
  readonly bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number };
}

const PAN_SPEED_PER_DISTANCE = 0.9;
const ROTATE_SPEED_TURNS = 0.22;
const ZOOM_STEP = 0.12;
const EDGE_PX = 14;
const DAMPING = 7;
const GROUND_CLEARANCE_M = 3;
const MIDDLE_DRAG_TURNS_PER_PX = 0.0012;
/** The opening shot: held on its first view, then a glide to the initial one. */
const INTRO_HOLD_S = 1.6;
const INTRO_GLIDE_S = 3.2;

/** The opening shot of a battle: where it starts, and when it may begin to move. */
export interface CameraIntro {
  readonly from: CameraView;
  /** False while the scene is still hidden (loading): the shot waits on its first view. */
  readonly play: boolean;
  /** The shot is over (finished or cut short). */
  readonly onDone: () => void;
}

/** Smootherstep (zero speed and acceleration at both ends). */
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** Shortest turn from a to b (turns, in [-0.5, 0.5)). */
const turnDelta = (a: number, b: number) => ((((b - a + 0.5) % 1) + 1) % 1) - 0.5;

export interface CameraHandle {
  setView(view: CameraView, immediate?: boolean): void;
  getView(): CameraView;
}

export function TacticalCamera({
  terrain,
  initial,
  limits,
  handleRef,
  inputEnabled = true,
  intro,
}: {
  readonly terrain: TerrainData;
  readonly initial: CameraView;
  readonly limits: CameraLimits;
  readonly handleRef?: { current: CameraHandle | null };
  readonly inputEnabled?: boolean;
  readonly intro?: CameraIntro;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const target = useRef({ ...initial, focus: { ...initial.focus } });
  const start = intro?.from ?? initial;
  const current = useRef({ ...start, focus: { ...start.focus } });
  /** The opening shot under way (seconds since it began to play), null once over. */
  const shot = useRef<{ t: number } | null>(intro ? { t: 0 } : null);
  const introRef = useRef(intro);
  introRef.current = intro;
  const endShot = useRef(() => {
    if (!shot.current) return;
    shot.current = null;
    introRef.current?.onDone();
  });
  const keys = useRef(new Set<string>());
  const pointer = useRef({ x: 0.5, y: 0.5, inside: false, dragging: false, lastX: 0 });
  const scratch = useRef(new Vector3());

  useEffect(() => {
    if (!handleRef) return undefined;
    handleRef.current = {
      setView: (view, immediate = false) => {
        endShot.current();
        target.current = { ...view, focus: { ...view.focus } };
        if (immediate) current.current = { ...view, focus: { ...view.focus } };
      },
      getView: () => ({ ...current.current, focus: { ...current.current.focus } }),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef]);

  useEffect(() => {
    if (!inputEnabled) return undefined;
    const el = gl.domElement;
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.code);
      endShot.current();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      endShot.current();
      const factor = 1 + Math.sign(e.deltaY) * ZOOM_STEP;
      target.current.distance = MathUtils.clamp(target.current.distance * factor, limits.minDistance, limits.maxDistance);
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.x = (e.clientX - r.left) / r.width;
      pointer.current.y = (e.clientY - r.top) / r.height;
      pointer.current.inside = true;
      if (pointer.current.dragging) {
        target.current.yawTurns -= (e.clientX - pointer.current.lastX) * MIDDLE_DRAG_TURNS_PER_PX;
        pointer.current.lastX = e.clientX;
      }
    };
    const onDown = (e: PointerEvent) => {
      endShot.current();
      if (e.button === 1) {
        pointer.current.dragging = true;
        pointer.current.lastX = e.clientX;
        e.preventDefault();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 1) pointer.current.dragging = false;
    };
    const onLeave = () => {
      pointer.current.inside = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [gl, inputEnabled, limits]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const t = target.current;
    const k = keys.current;
    let forward = 0;
    let right = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) forward += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) right += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) right -= 1;
    // The player's options: edge scrolling on or off, the pan and turn speed.
    const options = useSettings.getState();
    const pace = CAMERA_SPEEDS[options.cameraSpeed];
    if (inputEnabled && options.edgeScroll && pointer.current.inside && !pointer.current.dragging) {
      const w = gl.domElement.clientWidth;
      const h = gl.domElement.clientHeight;
      if (pointer.current.x * w < EDGE_PX) right -= 1;
      if (pointer.current.x * w > w - EDGE_PX) right += 1;
      if (pointer.current.y * h < EDGE_PX) forward += 1;
      if (pointer.current.y * h > h - EDGE_PX) forward -= 1;
    }
    if (k.has('KeyQ')) t.yawTurns += ROTATE_SPEED_TURNS * pace * delta;
    if (k.has('KeyE')) t.yawTurns -= ROTATE_SPEED_TURNS * pace * delta;
    if (forward !== 0 || right !== 0) {
      const yaw = t.yawTurns * 2 * Math.PI;
      const speed = t.distance * PAN_SPEED_PER_DISTANCE * pace * delta;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      t.focus.x += (fx * forward + -fz * right) * speed;
      t.focus.z += (fz * forward + fx * right) * speed;
    }
    t.focus.x = MathUtils.clamp(t.focus.x, limits.bounds.minX, limits.bounds.maxX);
    t.focus.z = MathUtils.clamp(t.focus.z, limits.bounds.minZ, limits.bounds.maxZ);

    const c = current.current;
    if (shot.current && introRef.current) {
      // The opening shot: held, then eased from its first view to the target.
      const from = introRef.current.from;
      if (introRef.current.play) shot.current.t += delta;
      const k = ease(MathUtils.clamp((shot.current.t - INTRO_HOLD_S) / INTRO_GLIDE_S, 0, 1));
      c.focus.x = MathUtils.lerp(from.focus.x, t.focus.x, k);
      c.focus.z = MathUtils.lerp(from.focus.z, t.focus.z, k);
      c.distance = MathUtils.lerp(from.distance, t.distance, k);
      c.yawTurns = from.yawTurns + turnDelta(from.yawTurns, t.yawTurns) * k;
      c.pitchDeg = MathUtils.lerp(from.pitchDeg, t.pitchDeg, k);
      if (k >= 1) endShot.current();
    }
    const a = 1 - Math.exp(-DAMPING * delta);
    c.focus.x += (t.focus.x - c.focus.x) * a;
    c.focus.z += (t.focus.z - c.focus.z) * a;
    c.distance += (t.distance - c.distance) * a;
    c.yawTurns += (t.yawTurns - c.yawTurns) * a;
    c.pitchDeg += (t.pitchDeg - c.pitchDeg) * a;
    const pitchDeg = MathUtils.clamp(c.pitchDeg, limits.minPitchDeg, limits.maxPitchDeg);

    const focusY = sampleHeight(terrain, c.focus.x, c.focus.z);
    const yaw = c.yawTurns * 2 * Math.PI;
    const pitch = MathUtils.degToRad(pitchDeg);
    const horizontal = Math.cos(pitch) * c.distance;
    const cam = scratch.current.set(c.focus.x + Math.sin(yaw) * horizontal, focusY + Math.sin(pitch) * c.distance, c.focus.z + Math.cos(yaw) * horizontal);
    const minY = sampleHeight(terrain, cam.x, cam.z) + GROUND_CLEARANCE_M;
    if (cam.y < minY) cam.y = minY;
    camera.position.copy(cam);
    camera.lookAt(c.focus.x, focusY, c.focus.z);
    paintedGlobals.uFocus.value.set(c.focus.x, focusY, c.focus.z);
    updateFogForCamera(c.distance);
  });

  return null;
}
