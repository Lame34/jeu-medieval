/** `window.__perf` as seen from Playwright tests (see src/render/debug/PerfProbe.tsx). */
interface TestPerfApi {
  readonly gpu: string;
  readonly webgl2: boolean;
  ready: boolean;
  renderer(): { calls: number; triangles: number; geometries: number; textures: number; programs: number };
}

interface Window {
  __perf?: TestPerfApi;
}
