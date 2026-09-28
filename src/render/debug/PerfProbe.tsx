/**
 * Frame-time and renderer.info probe exposed as `window.__perf` when the page URL carries
 * `?bench`. Used by scripts/perf-bench.ts and the e2e smoke test; zero cost otherwise.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { BatchedMesh, InstancedMesh, Mesh, type Object3D } from 'three';
import { renderScale } from '../quality/DynamicResolution.tsx';

const RING_SIZE = 8192;

export interface RendererSnapshot {
  readonly calls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  /** Dynamic resolution scale at the time of the snapshot. */
  readonly renderScale: number;
}

export interface PerfApi {
  readonly gpu: string;
  readonly webgl2: boolean;
  ready: boolean;
  /** Frame durations (ms) since the last reset. */
  frameTimes(): number[];
  reset(): void;
  renderer(): RendererSnapshot;
  /** Hook for bench/capture scripts (camera paths, time of day, scene switches). */
  control: Record<string, (...args: never[]) => unknown>;
}

declare global {
  interface Window {
    __perf?: PerfApi;
  }
}

export function isBenchMode(): boolean {
  return new URLSearchParams(window.location.search).has('bench');
}

export function readGpuString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(raw);
}

/**
 * Triangles per object family (name prefix before ':'), main pass, before frustum culling
 * (batched meshes: what they drew last). Shadow casters are listed apart. Debug aid for budgets.
 */
function triangleBreakdown(scene: Object3D): Record<string, { triangles: number; shadow: boolean }> {
  const out: Record<string, { triangles: number; shadow: boolean }> = {};
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof Mesh) {
      const g = o.geometry;
      const perDraw = Math.min(g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0), g.drawRange.count) / 3;
      let triangles = perDraw;
      if (o instanceof InstancedMesh) triangles = perDraw * o.count;
      if (o instanceof BatchedMesh) {
        const internals = o as unknown as { _multiDrawCount: number; _multiDrawCounts: Int32Array };
        triangles = 0;
        for (let i = 0; i < internals._multiDrawCount; i++) triangles += (internals._multiDrawCounts[i] ?? 0) / 3;
      }
      const key = (o.name || o.type).split(':')[0] as string;
      const entry = out[key] ?? { triangles: 0, shadow: false };
      entry.triangles += Math.round(triangles);
      entry.shadow ||= o.castShadow;
      out[key] = entry;
    }
    for (const child of o.children) visit(child);
  };
  visit(scene);
  return out;
}

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const ring = useRef(new Float32Array(RING_SIZE));
  const count = useRef(0);
  const last = useRef(0);
  const warmFrames = useRef(0);
  /** Totals of the previous whole frame (all post-processing passes included). */
  const frameInfo = useRef({ calls: 0, triangles: 0 });

  useEffect(() => {
    if (!isBenchMode()) return undefined;
    // The composer renders several passes per frame: accumulate, reset once per frame.
    gl.info.autoReset = false;
    const ctx = gl.getContext();
    const api: PerfApi = {
      gpu: readGpuString(ctx),
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext,
      ready: false,
      frameTimes: () => Array.from(ring.current.subarray(0, Math.min(count.current, RING_SIZE))),
      reset: () => {
        count.current = 0;
      },
      renderer: () => ({
        calls: frameInfo.current.calls,
        triangles: frameInfo.current.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
        renderScale: renderScale.value,
      }),
      control: window.__perf?.control ?? {},
    };
    api.control['breakdown'] = () => triangleBreakdown(scene);
    window.__perf = api;
    return () => {
      gl.info.autoReset = true;
      if (window.__perf === api) delete window.__perf;
    };
  }, [gl, scene]);

  useFrame(() => {
    const perf = window.__perf;
    if (!perf) return;
    frameInfo.current.calls = gl.info.render.calls;
    frameInfo.current.triangles = gl.info.render.triangles;
    gl.info.reset();
    const now = performance.now();
    if (last.current > 0) {
      ring.current[count.current % RING_SIZE] = now - last.current;
      count.current++;
    }
    last.current = now;
    // A few rendered frames prove the scene (and its shaders) are live.
    if (!perf.ready && ++warmFrames.current > 10) perf.ready = true;
  });

  return null;
}
