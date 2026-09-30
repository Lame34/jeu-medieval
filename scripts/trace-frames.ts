/**
 * Frame-hitch tracer: serves the production build, holds one camera view of a scene at 60 Hz
 * (vsync on, like a player), records a Chromium trace and reports the long frame intervals with
 * what filled them: animation-frame callbacks (scene update and draw submission), garbage
 * collection, GPU-process tasks.
 *
 * Usage: node scripts/trace-frames.ts [--scene battle] [--view 0] [--seconds 10] [--no-build] [--out trace.json]
 */
import { writeFileSync } from 'node:fs';
import { launch, openScene } from './browser.ts';
import { withPreview } from './preview-server.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]?.startsWith('--') ? (args[i + 1] as string) : fallback;
};
const SCENE = arg('scene', 'battle');
const VIEW = Number(arg('view', '0'));
const SECONDS = Number(arg('seconds', '10'));
const OUT = arg('out', '');
const WARMUP_MS = 2500;
/** A frame interval this long at 60 Hz has missed at least one vsync. */
const HITCH_MS = 25;
/** Events shorter than this are not listed inside a hitch. */
const LIST_MIN_MS = 1.5;
const CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'v8.gc', 'gpu', 'blink.user_timing'];

interface TraceEvent {
  readonly name: string;
  readonly cat: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
}

const ms = (us: number): number => us / 1000;
const isGc = (e: TraceEvent): boolean => e.cat.includes('v8.gc') || /GC|Scavenge|MarkCompact/i.test(e.name);

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function analyze(events: readonly TraceEvent[]): void {
  const complete = events.filter((e) => e.ph === 'X' && e.dur !== undefined);
  const raf = complete.filter((e) => e.name === 'FireAnimationFrame').sort((a, b) => a.ts - b.ts);
  if (raf.length < 2) throw new Error('no FireAnimationFrame events: the trace categories did not record frames');
  const rafMs = raf.map((e) => ms(e.dur ?? 0));
  const gc = complete.filter(isGc);
  const gpu = complete.filter((e) => e.name === 'GPUTask');
  console.log(`${SCENE} view ${VIEW}: ${raf.length} animation frames over ${SECONDS} s`);
  console.log(`  rAF callback (JS update + draw submission): median ${percentile(rafMs, 0.5).toFixed(2)} ms · p99 ${percentile(rafMs, 0.99).toFixed(2)} ms · max ${Math.max(...rafMs).toFixed(2)} ms`);
  console.log(`  GC: ${gc.length} events · total ${ms(gc.reduce((s, e) => s + (e.dur ?? 0), 0)).toFixed(1)} ms · max ${gc.length ? Math.max(...gc.map((e) => ms(e.dur ?? 0))).toFixed(2) : '0'} ms`);
  console.log(`  GPU tasks: ${gpu.length} · p99 ${percentile(gpu.map((e) => ms(e.dur ?? 0)), 0.99).toFixed(2)} ms · max ${gpu.length ? Math.max(...gpu.map((e) => ms(e.dur ?? 0))).toFixed(2) : '0'} ms`);
  const hitches: { start: number; end: number }[] = [];
  for (let i = 1; i < raf.length; i++) {
    const a = raf[i - 1] as TraceEvent;
    const b = raf[i] as TraceEvent;
    if (ms(b.ts - a.ts) > HITCH_MS) hitches.push({ start: a.ts, end: b.ts });
  }
  console.log(`  hitches (> ${HITCH_MS} ms between animation frames): ${hitches.length}`);
  for (const h of hitches.slice(0, 12)) {
    const inside = complete
      .filter((e) => e.ts < h.end && e.ts + (e.dur ?? 0) > h.start && ms(e.dur ?? 0) >= LIST_MIN_MS)
      .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
      .slice(0, 5)
      .map((e) => `${e.name} ${ms(e.dur ?? 0).toFixed(1)}`);
    console.log(`    ${ms(h.end - h.start).toFixed(1)} ms at +${ms(h.start - (raf[0] as TraceEvent).ts).toFixed(0)} ms: ${inside.join(', ') || '(nothing traced: compositor or GPU wait)'}`);
  }
}

await withPreview({ build: !args.includes('--no-build') }, async () => {
  const browser = await launch();
  try {
    const { page } = await openScene(browser, `/${SCENE}?bench&preset=portable&fixedres`);
    await page.evaluate((i) => (window.__perf?.control['setView'] as (i: number) => void)(i), VIEW);
    await page.waitForTimeout(WARMUP_MS);
    const cdp = await page.context().newCDPSession(page);
    const events: TraceEvent[] = [];
    cdp.on('Tracing.dataCollected', (e) => events.push(...(e.value as unknown as TraceEvent[])));
    const complete = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
    await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: CATEGORIES } });
    await page.waitForTimeout(SECONDS * 1000);
    await cdp.send('Tracing.end');
    await complete;
    if (OUT) writeFileSync(OUT, JSON.stringify({ traceEvents: events }));
    analyze(events);
  } finally {
    await browser.close();
  }
});
