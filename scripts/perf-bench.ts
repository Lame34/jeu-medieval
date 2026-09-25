/**
 * GPU benchmark (brief §7, ADR-007/012). Builds the app, serves the production bundle, drives
 * new-headless Chromium on the Intel Arc with vsync off, and measures each camera view:
 * average FPS, 1 % low, median frame time, draw calls and triangles, optionally with Chrome's
 * CPU throttling. Refuses to report a "portable" result on any GPU other than the Intel iGPU.
 *
 * Usage: node scripts/perf-bench.ts [--preset portable] [--scene lookdev] [--cpu-throttle 4]
 *                                   [--seconds 5] [--no-build] [--log]
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gpuString, isIntelArc, launch, openScene } from './browser.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]?.startsWith('--') ? (args[i + 1] as string) : fallback;
};
const flag = (name: string): boolean => args.includes(`--${name}`);

const PRESET = arg('preset', 'portable');
const SCENE = arg('scene', 'lookdev');
const CPU_THROTTLE = Number(arg('cpu-throttle', '1'));
const SECONDS = Number(arg('seconds', '5'));
const WARMUP_MS = 2500;
const PREVIEW_PORT = 4188;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const LOW_PERCENTILE = 0.99;
const BUDGET = { avgFps: 60, lowFps: 40, throttledAvgFps: 40, drawCalls: 150, triangles: 1_500_000 };

interface ViewResult {
  readonly view: number;
  readonly avgFps: number;
  readonly lowFps: number;
  readonly medianMs: number;
  readonly frames: number;
  readonly calls: number;
  readonly triangles: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server ${url} did not start`);
}

interface Pass {
  readonly gpu: string;
  readonly views: { times: number[]; calls: number; triangles: number }[];
  readonly heapBytes: number;
  readonly textures: number;
  readonly errors: string[];
}

/**
 * One measurement pass. Uncapped (vsync off) gives throughput/headroom; capped (vsync on,
 * 60 Hz) gives meaningful frame pacing for the 1 % low — uncapped rAF intervals come in bursts.
 */
async function measurePass(uncapped: boolean): Promise<Pass> {
  const browser = await launch({ uncapped });
  try {
    const { page, errors } = await openScene(browser, `/${SCENE}?bench&preset=${PRESET}`);
    const gpu = await gpuString(page);
    if (PRESET === 'portable' && !isIntelArc(gpu)) throw new Error(`Refusing a "portable" measurement on a non-Intel GPU: ${gpu}`);
    if (CPU_THROTTLE > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
    }
    const viewCount = await page.evaluate(() => (window.__perf?.control['viewCount'] as () => number)());
    const views: Pass['views'] = [];
    for (let view = 0; view < viewCount; view++) {
      await page.evaluate((i) => (window.__perf?.control['setView'] as (i: number) => void)(i), view);
      await page.waitForTimeout(WARMUP_MS);
      await page.evaluate(() => window.__perf?.reset());
      await page.waitForTimeout(SECONDS * 1000);
      const sample = await page.evaluate(() => ({ times: window.__perf?.frameTimes() ?? [], info: window.__perf?.renderer() }));
      views.push({ times: sample.times, calls: sample.info?.calls ?? 0, triangles: sample.info?.triangles ?? 0 });
    }
    const heapBytes = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
    const textures = await page.evaluate(() => window.__perf?.renderer().textures ?? 0);
    return { gpu, views, heapBytes, textures, errors };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  if (!flag('no-build')) execSync('npx vite build --logLevel warn', { stdio: 'inherit' });
  const preview: ChildProcess = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
  try {
    await waitForServer(PREVIEW_URL, 30_000);
    process.env['SIEGE_URL'] = PREVIEW_URL;
    const throughput = await measurePass(true);
    const pacing = await measurePass(false);
    console.log(`GPU: ${throughput.gpu}`);
    const results: ViewResult[] = throughput.views.map((v, view) => {
      const total = v.times.reduce((s, t) => s + t, 0);
      const paced = [...(pacing.views[view]?.times ?? [])].sort((a, b) => a - b);
      const sorted = [...v.times].sort((a, b) => a - b);
      return {
        view,
        avgFps: total > 0 ? (1000 * v.times.length) / total : 0,
        lowFps: 1000 / Math.max(percentile(paced, LOW_PERCENTILE), 1e-3),
        medianMs: percentile(sorted, 0.5),
        frames: v.times.length,
        calls: v.calls,
        triangles: v.triangles,
      };
    });
    report(throughput.gpu, results, throughput.heapBytes, throughput.textures, [...throughput.errors, ...pacing.errors]);
  } finally {
    preview.kill();
    if (process.platform === 'win32' && preview.pid) {
      try {
        execSync(`taskkill /pid ${preview.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    }
  }
}

function report(gpu: string, results: ViewResult[], heapBytes: number, textures: number, errors: string[]): void {
  const avg = results.reduce((s, r) => s + r.avgFps, 0) / results.length;
  const low = Math.min(...results.map((r) => r.lowFps));
  const calls = Math.max(...results.map((r) => r.calls));
  const tris = Math.max(...results.map((r) => r.triangles));
  const fpsBudget = CPU_THROTTLE > 1 ? BUDGET.throttledAvgFps : BUDGET.avgFps;
  const verdict = avg >= fpsBudget && (CPU_THROTTLE > 1 || low >= BUDGET.lowFps) && calls < BUDGET.drawCalls && tris < BUDGET.triangles;
  console.log(`scene=${SCENE} preset=${PRESET} cpuThrottle=×${CPU_THROTTLE}`);
  for (const r of results) {
    console.log(`  view ${r.view}: avg ${r.avgFps.toFixed(1)} fps · 1% low ${r.lowFps.toFixed(1)} · median ${r.medianMs.toFixed(2)} ms · ${r.calls} calls · ${(r.triangles / 1000).toFixed(0)}k tris · ${r.frames} frames`);
  }
  console.log(`TOTAL avg ${avg.toFixed(1)} fps · worst 1% low ${low.toFixed(1)} · max ${calls} calls · max ${(tris / 1e6).toFixed(2)} M tris · heap ${(heapBytes / 1048576).toFixed(0)} MB · ${textures} textures → ${verdict ? 'WITHIN BUDGET' : 'OVER BUDGET'}`);
  if (errors.length > 0) console.log(`console errors: ${errors.length}`);

  const stamp = new Date().toISOString();
  mkdirSync('perf-results', { recursive: true });
  writeFileSync(join('perf-results', `${stamp.replace(/[:.]/g, '-')}-${SCENE}-${PRESET}-x${CPU_THROTTLE}.json`), JSON.stringify({ stamp, gpu, SCENE, PRESET, CPU_THROTTLE, results }, null, 2));
  if (flag('log')) {
    const commit = execSync('git rev-parse --short HEAD').toString().trim();
    const line = `| ${stamp.slice(0, 16).replace('T', ' ')} | ${commit} | ${SCENE} | ${PRESET} | ×${CPU_THROTTLE} | ${avg.toFixed(1)} | ${low.toFixed(1)} | ${calls} | ${(tris / 1e6).toFixed(2)} M | ${textures} | ${verdict ? '✅' : '❌'} |\n`;
    appendFileSync('docs/PERF_LOG.md', line);
    console.log('→ docs/PERF_LOG.md');
  }
}

await main();
