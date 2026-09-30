/**
 * Per-frame allocation hunt (render invariant: no allocation in useFrame). Opens a scene on the
 * dev server (readable function names and module URLs), holds one view at 60 Hz, samples every
 * heap allocation for a while (objects already collected included) and lists the allocation
 * sites by bytes allocated per second.
 *
 * Usage: node scripts/alloc-profile.ts [--scene battle] [--view 0] [--seconds 10] [--top 20]
 * Needs the dev server (npm run dev) on :5188.
 */
import { launch, openScene } from './browser.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]?.startsWith('--') ? (args[i + 1] as string) : fallback;
};
const SCENE = arg('scene', 'battle');
const VIEW = Number(arg('view', '0'));
const SECONDS = Number(arg('seconds', '10'));
const TOP = Number(arg('top', '20'));
const WARMUP_MS = 4000;
const SAMPLING_INTERVAL_BYTES = 1024;

interface ProfileNode {
  readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber: number };
  readonly selfSize: number;
  readonly children: readonly ProfileNode[];
}

const browser = await launch();
try {
  const { page } = await openScene(browser, `/${SCENE}?bench&preset=portable&fixedres`);
  await page.evaluate((i) => (window.__perf?.control['setView'] as (i: number) => void)(i), VIEW);
  await page.waitForTimeout(WARMUP_MS);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: SAMPLING_INTERVAL_BYTES,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  } as never);
  await page.waitForTimeout(SECONDS * 1000);
  const { profile } = (await cdp.send('HeapProfiler.stopSampling')) as unknown as { profile: { head: ProfileNode } };
  // Self bytes per allocation site, with the nearest caller inside the app for context.
  const sites = new Map<string, number>();
  const visit = (node: ProfileNode, appCaller: string) => {
    const { functionName, url, lineNumber } = node.callFrame;
    const file = url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '');
    const here = `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`;
    const caller = file.startsWith('src/') ? here : appCaller;
    if (node.selfSize > 0) {
      const key = file.startsWith('src/') ? here : `${here}  ← ${caller}`;
      sites.set(key, (sites.get(key) ?? 0) + node.selfSize);
    }
    for (const child of node.children) visit(child, caller);
  };
  visit(profile.head, '(outside the app)');
  const total = [...sites.values()].reduce((s, v) => s + v, 0);
  console.log(`${SCENE} view ${VIEW}: ${(total / SECONDS / 1024).toFixed(0)} KiB allocated per second (sampled)`);
  for (const [site, bytes] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`  ${(bytes / SECONDS / 1024).toFixed(1).padStart(7)} KiB/s  ${site}`);
  }
} finally {
  await browser.close();
}
