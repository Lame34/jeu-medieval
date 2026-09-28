/**
 * Dynamic resolution (brief §7, presets `minRenderScale`–`maxRenderScale`): when frames start
 * missing the 60 Hz budget — typically when a laptop iGPU heats up after minutes of play and
 * drops its clocks — the render scale steps down; it climbs back once frames are steady again.
 *
 * The trigger counts slow frames (> 20 ms) rather than averaging frame times, so it behaves
 * the same with vsync on (on-time frames last 16.7 ms, missed ones 33 ms) and off.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { EffectComposer } from 'postprocessing';
import { Vector2 } from 'three';

const SLOW_FRAME_S = 0.02;
const WINDOW_FRAMES = 90;
const SLOW_FRAMES_TO_DROP = 3;
const STEADY_FRAMES_TO_CLIMB = 240;
const DROP_STEP = 0.08;
const CLIMB_STEP = 0.04;
const COOLDOWN_FRAMES = 45;

export interface RenderScaleRange {
  readonly min: number;
  readonly max: number;
}

const scratchSize = new Vector2();
/** `?fixedres`: captures stay at full resolution (look-dev comparisons must be like for like). */
const FIXED = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fixedres');

/** Current render scale, for probes and the HUD (1 = full resolution of the capped DPR). */
export const renderScale = { value: 1 };

export function DynamicResolution({ composer, range }: { readonly composer: { readonly current: EffectComposer | null }; readonly range: RenderScaleRange }) {
  const gl = useThree((s) => s.gl);
  const baseDpr = useThree((s) => s.viewport.dpr);
  const state = useRef({ slow: new Uint8Array(WINDOW_FRAMES), cursor: 0, slowCount: 0, steady: 0, cooldown: 0, scale: range.max });

  useEffect(() => {
    // Start at the top of the range whenever the base DPR or the preset changes.
    state.current.scale = range.max;
    renderScale.value = range.max;
    gl.setPixelRatio(baseDpr * range.max);
  }, [gl, baseDpr, range.max]);

  useFrame((_, delta) => {
    if (FIXED) return;
    const s = state.current;
    const slow = delta > SLOW_FRAME_S ? 1 : 0;
    s.slowCount += slow - (s.slow[s.cursor] as number);
    s.slow[s.cursor] = slow;
    s.cursor = (s.cursor + 1) % WINDOW_FRAMES;
    s.steady = slow ? 0 : s.steady + 1;
    if (s.cooldown > 0) {
      s.cooldown--;
      return;
    }
    let next = s.scale;
    if (s.slowCount >= SLOW_FRAMES_TO_DROP) next = Math.max(range.min, s.scale - DROP_STEP);
    else if (s.steady >= STEADY_FRAMES_TO_CLIMB) next = Math.min(range.max, s.scale + CLIMB_STEP);
    if (next === s.scale) return;
    s.scale = next;
    s.cooldown = COOLDOWN_FRAMES;
    s.steady = 0;
    s.slow.fill(0);
    s.slowCount = 0;
    renderScale.value = next;
    gl.setPixelRatio(baseDpr * next);
    // The composer sizes its buffers from the renderer's pixel ratio, but only re-sizes on
    // CSS size changes: resize it here or the scene would still render at full resolution.
    const size = gl.getSize(scratchSize);
    composer.current?.setSize(size.x, size.y);
  });

  return null;
}
