/**
 * Frame cost breakdown per object family (J3 profiling, ADR-022). Serves the production build,
 * holds each camera view with vsync off, and measures the mean frame time with each family
 * hidden in turn, then with the shadow pass frozen, then with everything hidden (what remains:
 * post-processing, clears, fixed per-frame work). A fresh baseline precedes every variant, so
 * the iGPU's thermal drift cancels out. Costs are whole-frame (CPU submission included).
 *
 * WebGL timer queries were tried and rejected: in Chromium/ANGLE they time the GPU queue
 * between two timestamps, including other contexts' work and swap-chain waits.
 *
 * Usage: node scripts/frame-breakdown.ts [--scene battle] [--views 0,2] [--seconds 3] [--pairs 2] [--no-build] [--verbose]
 */
import type { Page } from '@playwright/test';
import { launch, openScene } from './browser.ts';
import { withPreview } from './preview-server.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]?.startsWith('--') ? (args[i + 1] as string) : fallback;
};
const SCENE = arg('scene', 'battle');
const SAMPLE_MS = Number(arg('seconds', '3')) * 1000;
/** Baseline/variant pairs per family; the median of the paired differences is kept. */
const PAIRS = Number(arg('pairs', '2'));
const VERBOSE = args.includes('--verbose');
const WARMUP_MS = 2500;
const SETTLE_MS = 300;
/** Families below this cost are folded into one line. */
const REPORT_MIN_MS = 0.15;

type Control = Record<string, (...a: never[]) => unknown>;

const call = <T>(page: Page, name: string, ...params: unknown[]): Promise<T> =>
  page.evaluate(([n, p]) => ((window.__perf?.control as Control)[n as string] as (...a: unknown[]) => unknown)(...(p as unknown[])), [name, params] as const) as Promise<T>;

/** Mean frame time (ms) over the sample window: throughput, meaningful even with rAF bursts. */
async function measure(page: Page): Promise<number> {
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(() => window.__perf?.reset());
  await page.waitForTimeout(SAMPLE_MS);
  const times = await page.evaluate(() => window.__perf?.frameTimes() ?? []);
  if (times.length === 0) throw new Error('no frames recorded');
  return times.reduce((s, t) => s + t, 0) / times.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function breakdownView(page: Page, view: number): Promise<void> {
  await call(page, 'setView', view);
  await page.waitForTimeout(WARMUP_MS);
  const families = Object.keys(await call<Record<string, unknown>>(page, 'breakdown'));
  const rows: { name: string; ms: number }[] = [];
  const baselines: number[] = [];
  const variant = async (name: string, apply: () => Promise<unknown>, undo: () => Promise<unknown>) => {
    const diffs: number[] = [];
    for (let k = 0; k < PAIRS; k++) {
      const base = await measure(page);
      baselines.push(base);
      await apply();
      const without = await measure(page);
      await undo();
      diffs.push(base - without);
      if (VERBOSE) console.log(`    ${name}: ${base.toFixed(2)} → ${without.toFixed(2)} ms`);
    }
    rows.push({ name, ms: median(diffs) });
  };
  for (const f of families) await variant(f, () => call(page, 'hide', [f]), () => call(page, 'showAll'));
  await variant('(shadow pass)', () => call(page, 'shadowPass', false), () => call(page, 'shadowPass', true));
  await call(page, 'hide', families);
  await call(page, 'shadowPass', false);
  const residual = await measure(page);
  await call(page, 'showAll');
  await call(page, 'shadowPass', true);
  const base = median(baselines);
  console.log(`\n${SCENE} view ${view}: ${base.toFixed(2)} ms per frame, ${(1000 / base).toFixed(0)} FPS (baselines ${Math.min(...baselines).toFixed(2)}–${Math.max(...baselines).toFixed(2)} ms)`);
  rows.sort((a, b) => b.ms - a.ms);
  let small = 0;
  for (const r of rows) {
    if (r.ms < REPORT_MIN_MS) {
      small += r.ms;
      continue;
    }
    console.log(`  ${r.name.padEnd(22)} ${r.ms.toFixed(2).padStart(6)} ms  ${((100 * r.ms) / base).toFixed(0).padStart(3)} %`);
  }
  console.log(`  ${'(others, each < 0.15)'.padEnd(22)} ${small.toFixed(2).padStart(6)} ms`);
  console.log(`  ${'(nothing drawn)'.padEnd(22)} ${residual.toFixed(2).padStart(6)} ms  ${((100 * residual) / base).toFixed(0).padStart(3)} %`);
}

await withPreview({ build: !args.includes('--no-build') }, async () => {
  const browser = await launch({ uncapped: true });
  try {
    const { page } = await openScene(browser, `/${SCENE}?bench&preset=portable&fixedres`);
    const count = await call<number>(page, 'viewCount');
    const requested = arg('views', '');
    const views = requested ? requested.split(',').map(Number) : Array.from({ length: count }, (_, i) => i);
    for (const v of views) await breakdownView(page, v);
  } finally {
    await browser.close();
  }
});
