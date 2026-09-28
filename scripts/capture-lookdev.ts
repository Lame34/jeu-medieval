/**
 * Scene captures (brief §13): every camera view of the scene × 3 hours →
 * docs/captures/<date>-<tag>/ (look-dev: 4 fixed angles; battle: the map's derived views).
 * Requires the dev server (npm run dev).
 * Usage: node scripts/capture-lookdev.ts [tag] [--scene lookdev|battle] [--query "seed=…"] [--headed]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gpuString, launch, openScene } from './browser.ts';

const HOURS = [
  { id: 'morning', hour: 8 },
  { id: 'afternoon', hour: 16.5 },
  { id: 'dusk', hour: 19.5 },
] as const;
const SETTLE_MS = 1500;

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};
const tag = args[0] && !args[0].startsWith('--') ? args[0] : 'iter';
const scene = option('scene', 'lookdev');
const query = option('query', '');
const date = new Date().toISOString().slice(0, 10);
const outDir = join('docs', 'captures', `${date}-${tag}`);
mkdirSync(outDir, { recursive: true });

const browser = await launch({ headed: process.argv.includes('--headed') });
try {
  const started = Date.now();
  const { page, errors } = await openScene(browser, `/${scene}?bench&fixedres${query ? `&${query}` : ''}`);
  const worldgenMs = await page.evaluate(() => document.body.dataset['worldgenMs'] ?? '-');
  console.log(`GPU: ${await gpuString(page)}`);
  console.log(`load: ${((Date.now() - started) / 1000).toFixed(1)} s to scene ready (worldgen ${worldgenMs} ms)`);
  const views = await page.evaluate(() => (window.__perf?.control['viewIds'] as () => string[])());
  for (const h of HOURS) {
    await page.evaluate((hour) => (window.__perf?.control['setHour'] as (h: number) => void)(hour), h.hour);
    for (const [i, view] of views.entries()) {
      await page.evaluate((index) => (window.__perf?.control['setView'] as (i: number) => void)(index), i);
      await page.waitForTimeout(SETTLE_MS);
      const file = join(outDir, `${scene === 'lookdev' ? '' : `${scene}-`}${view}-${h.id}.png`);
      await page.screenshot({ path: file });
      console.log(`→ ${file}`);
      if (args.includes('--breakdown') && h.id === 'afternoon') {
        const info = await page.evaluate(() => window.__perf?.renderer());
        const parts = await page.evaluate(() => (window.__perf?.control['breakdown'] as () => Record<string, { triangles: number; shadow: boolean }>)());
        const top = Object.entries(parts)
          .sort(([, a], [, b]) => b.triangles - a.triangles)
          .map(([k, v]) => `${k}${v.shadow ? '*' : ''} ${(v.triangles / 1000).toFixed(0)}k`);
        console.log(`   calls ${info?.calls} tris ${((info?.triangles ?? 0) / 1e6).toFixed(2)}M | ${top.join(', ')}`);
      }
    }
  }
  const info = await page.evaluate(() => window.__perf?.renderer());
  console.log('renderer.info', JSON.stringify(info));
  if (errors.length > 0) console.log(`console errors:\n  ${errors.slice(0, 10).join('\n  ')}`);
} finally {
  await browser.close();
}
