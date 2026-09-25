/**
 * Look-dev captures (brief §13): 4 fixed angles × 3 hours → docs/captures/<date>-<tag>/.
 * Requires the dev server (npm run dev). Usage: node scripts/capture-lookdev.ts [tag] [--headed]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gpuString, launch, openScene } from './browser.ts';

const VIEWS = ['overview', 'tactical', 'close', 'castle'] as const;
const HOURS = [
  { id: 'morning', hour: 8 },
  { id: 'afternoon', hour: 16.5 },
  { id: 'dusk', hour: 19.5 },
] as const;
const SETTLE_MS = 1500;

const tag = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'iter';
const date = new Date().toISOString().slice(0, 10);
const outDir = join('docs', 'captures', `${date}-${tag}`);
mkdirSync(outDir, { recursive: true });

const browser = await launch({ headed: process.argv.includes('--headed') });
try {
  const { page, errors } = await openScene(browser, '/lookdev?bench');
  console.log(`GPU: ${await gpuString(page)}`);
  for (const h of HOURS) {
    await page.evaluate((hour) => (window.__perf?.control['setHour'] as (h: number) => void)(hour), h.hour);
    for (const [i, view] of VIEWS.entries()) {
      await page.evaluate((index) => (window.__perf?.control['setView'] as (i: number) => void)(index), i);
      await page.waitForTimeout(SETTLE_MS);
      const file = join(outDir, `${view}-${h.id}.png`);
      await page.screenshot({ path: file });
      console.log(`→ ${file}`);
    }
  }
  const info = await page.evaluate(() => window.__perf?.renderer());
  console.log('renderer.info', JSON.stringify(info));
  if (errors.length > 0) console.log(`console errors:\n  ${errors.slice(0, 10).join('\n  ')}`);
} finally {
  await browser.close();
}
