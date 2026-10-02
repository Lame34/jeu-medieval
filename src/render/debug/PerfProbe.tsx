/**
 * Frame-time and renderer.info probe exposed as `window.__perf` when the page URL carries
 * `?bench`. Used by scripts/perf-bench.ts and the e2e smoke test; zero cost otherwise.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { BatchedMesh, InstancedMesh, Mesh, type Material, type Object3D } from 'three';
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

/** Object family: the name prefix before ':' (the grouping of the triangle breakdown). */
function family(o: Object3D): string {
  return (o.name || o.type).split(':')[0] as string;
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
      const key = family(o);
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
    // Cost breakdown (scripts/frame-breakdown.ts): families hidden by name, and the shadow pass
    // frozen (no re-render, no shader recompile).
    const hidden: Object3D[] = [];
    api.control['hide'] = (families: readonly string[]) => {
      scene.traverse((o) => {
        if (o.visible && o !== scene && families.includes(family(o))) {
          o.visible = false;
          hidden.push(o);
        }
      });
    };
    api.control['showAll'] = () => {
      for (const o of hidden.splice(0)) o.visible = true;
    };
    // Materials drawn by objects of different kinds: three switches their program on every draw
    // (getParameters + cache key strings each time), a per-frame CPU and allocation cost.
    api.control['sharedMaterials'] = () => {
      const kinds = new Map<string, { name: string; signatures: Set<string>; users: Set<string> }>();
      scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const colors = (o.geometry as { getAttribute(n: string): { itemSize: number } | undefined }).getAttribute('color');
        const signature = [
          o instanceof InstancedMesh ? `instanced${o.instanceColor ? '+color' : ''}` : '',
          o instanceof BatchedMesh ? 'batched' : '',
          (o as { isSkinnedMesh?: boolean }).isSkinnedMesh ? 'skinned' : '',
          colors ? `vc${colors.itemSize}` : '',
        ].join('|');
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const entry = kinds.get(m.uuid) ?? { name: m.name || m.type, signatures: new Set<string>(), users: new Set<string>() };
          entry.signatures.add(signature);
          entry.users.add(family(o));
          kinds.set(m.uuid, entry);
        }
      });
      return [...kinds.values()].filter((k) => k.signatures.size > 1).map((k) => ({ material: k.name, signatures: [...k.signatures], users: [...k.users] }));
    };
    // Shader programs per material (load-time budget: every program is compiled behind the
    // loading screen).
    api.control['programList'] = () => {
      const rows: { material: string; type: string; programs: number }[] = [];
      const seen = new Set<string>();
      scene.traverse((o) => {
        const m = (o as { material?: Material | Material[] }).material;
        for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) {
          if (seen.has(mat.uuid)) continue;
          seen.add(mat.uuid);
          const programs = (gl.properties.get(mat) as { programs?: Map<string, unknown> }).programs?.size ?? 0;
          rows.push({ material: mat.name || '(unnamed)', type: mat.type, programs });
        }
      });
      return rows;
    };
    api.control['shadowPass'] = (on: boolean) => {
      gl.shadowMap.autoUpdate = on;
      gl.shadowMap.needsUpdate = true;
    };
    window.__perf = api;
    return () => {
      gl.info.autoReset = true;
      gl.shadowMap.autoUpdate = true;
      for (const o of hidden.splice(0)) o.visible = true;
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
