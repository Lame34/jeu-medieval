/**
 * GPU benchmark (brief §7, ADR-007/012). Builds the app, serves the production bundle, drives
 * new-headless Chromium on the Intel Arc with vsync off, and measures each camera view:
 * average FPS, 1 % low, median frame time, draw calls and triangles, optionally with Chrome's
 * CPU throttling. Refuses to report a "portable" result on any GPU other than the Intel iGPU.
 *
 * Usage: node scripts/perf-bench.ts [--preset portable] [--scene lookdev] [--cpu-throttle 4] [--fixedres]
 *                                   [--seconds 5] [--no-build] [--log]
 */
import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseUrl, gpuString, isIntelArc, launch, openScene } from './browser.ts';
import { withPreview } from './preview-server.ts';

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
const LOW_PERCENTILE = 0.99;
/** A frame this long at 60 Hz has missed at least one vsync (uncapped medians are meaningless: rAF bursts). */
const HITCH_MS = 25;
const BUDGET = { avgFps: 60, lowFps: 40, throttledAvgFps: 40, drawCalls: 150, triangles: 1_500_000, loadS: 10 };

interface ViewResult {
  readonly view: number;
  readonly avgFps: number;
  readonly lowFps: number;
  /** Frames over HITCH_MS in the paced (60 Hz) pass: rare stalls rather than a slow average. */
  readonly hitches: number;
  readonly pacedFrames: number;
  readonly frames: number;
  readonly calls: number;
  readonly triangles: number;
  /** Dynamic resolution scale at the end of the paced pass. */
  readonly scale: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

interface Pass {
  readonly gpu: string;
  readonly views: { times: number[]; calls: number; triangles: number; scale: number }[];
  readonly heapBytes: number;
  readonly textures: number;
  readonly errors: string[];
  /** Navigation start → scene ready (s), in a fresh browser (document.body.dataset.readyAtMs). */
  readonly loadS: number;
}

/**
 * One measurement pass. Uncapped (vsync off) gives throughput/headroom; capped (vsync on,
 * 60 Hz) gives meaningful frame pacing for the 1 % low — uncapped rAF intervals come in bursts.
 */
async function measurePass(uncapped: boolean): Promise<Pass> {
  const browser = await launch({ uncapped });
  try {
    const { page, errors } = await openScene(browser, `/${SCENE}?bench&preset=${PRESET}${flag('fixedres') ? '&fixedres' : ''}`);
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
      views.push({ times: sample.times, calls: sample.info?.calls ?? 0, triangles: sample.info?.triangles ?? 0, scale: sample.info?.renderScale ?? 1 });
    }
    const heapBytes = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
    const loadS = (await page.evaluate(() => Number(document.body.dataset['readyAtMs'] ?? 'NaN'))) / 1000;
    const textures = await page.evaluate(() => window.__perf?.renderer().textures ?? 0);
    return { gpu, views, heapBytes, textures, errors, loadS };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  await withPreview({ build: !flag('no-build') }, async () => {
    const throughput = await measurePass(true);
    const pacing = await measurePass(false);
    console.log(`GPU: ${throughput.gpu}`);
    const results: ViewResult[] = throughput.views.map((v, view) => {
      const total = v.times.reduce((s, t) => s + t, 0);
      const paced = [...(pacing.views[view]?.times ?? [])].sort((a, b) => a - b);
      return {
        view,
        avgFps: total > 0 ? (1000 * v.times.length) / total : 0,
        lowFps: 1000 / Math.max(percentile(paced, LOW_PERCENTILE), 1e-3),
        hitches: paced.filter((t) => t > HITCH_MS).length,
        pacedFrames: paced.length,
        frames: v.times.length,
        calls: v.calls,
        triangles: v.triangles,
        scale: pacing.views[view]?.scale ?? 1,
      };
    });
    report(throughput.gpu, results, throughput.heapBytes, throughput.textures, [...throughput.errors, ...pacing.errors], Math.max(throughput.loadS, pacing.loadS));
  });
}

function report(gpu: string, results: ViewResult[], heapBytes: number, textures: number, errors: string[], loadS: number): void {
  const avg = results.reduce((s, r) => s + r.avgFps, 0) / results.length;
  const low = Math.min(...results.map((r) => r.lowFps));
  const calls = Math.max(...results.map((r) => r.calls));
  const tris = Math.max(...results.map((r) => r.triangles));
  const fpsBudget = CPU_THROTTLE > 1 ? BUDGET.throttledAvgFps : BUDGET.avgFps;
  const verdict = avg >= fpsBudget && (CPU_THROTTLE > 1 || low >= BUDGET.lowFps) && calls < BUDGET.drawCalls && tris < BUDGET.triangles && (CPU_THROTTLE > 1 || !(loadS >= BUDGET.loadS));
  console.log(`scene=${SCENE} preset=${PRESET} cpuThrottle=×${CPU_THROTTLE} url=${baseUrl()}`);
  for (const r of results) {
    console.log(`  view ${r.view}: avg ${r.avgFps.toFixed(1)} fps · 1% low ${r.lowFps.toFixed(1)} · hitches ${r.hitches}/${r.pacedFrames} (> ${HITCH_MS} ms) · ${r.calls} calls · ${(r.triangles / 1000).toFixed(0)}k tris · ${r.frames} frames · scale ${r.scale.toFixed(2)}`);
  }
  console.log(`TOTAL avg ${avg.toFixed(1)} fps · worst 1% low ${low.toFixed(1)} · max ${calls} calls · max ${(tris / 1e6).toFixed(2)} M tris · heap ${(heapBytes / 1048576).toFixed(0)} MB · ${textures} textures · load ${loadS.toFixed(1)} s → ${verdict ? 'WITHIN BUDGET' : 'OVER BUDGET'}`);
  if (errors.length > 0) console.log(`console errors: ${errors.length}`);

  const stamp = new Date().toISOString();
  mkdirSync('perf-results', { recursive: true });
  writeFileSync(join('perf-results', `${stamp.replace(/[:.]/g, '-')}-${SCENE}-${PRESET}-x${CPU_THROTTLE}.json`), JSON.stringify({ stamp, gpu, SCENE, PRESET, CPU_THROTTLE, loadS, results }, null, 2));
  if (flag('log')) {
    const commit = execSync('git rev-parse --short HEAD').toString().trim();
    const line = `| ${stamp.slice(0, 16).replace('T', ' ')} | ${commit} | ${SCENE} | ${PRESET} | ×${CPU_THROTTLE} | ${avg.toFixed(1)} | ${low.toFixed(1)} | ${calls} | ${(tris / 1e6).toFixed(2)} M | ${textures} | ${verdict ? '✅' : '❌'} |\n`;
    appendFileSync('docs/PERF_LOG.md', line);
    console.log('→ docs/PERF_LOG.md');
  }
}

await main();
