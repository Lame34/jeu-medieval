/** Shape of `window.__perf` as seen from Playwright scripts (see src/render/debug/PerfProbe.tsx). */
interface ScriptPerfApi {
  readonly gpu: string;
  readonly webgl2: boolean;
  ready: boolean;
  frameTimes(): number[];
  reset(): void;
  renderer(): { calls: number; triangles: number; geometries: number; textures: number; programs: number; renderScale?: number };
  control: Record<string, (...args: never[]) => unknown>;
}

interface Window {
  __perf?: ScriptPerfApi;
}
