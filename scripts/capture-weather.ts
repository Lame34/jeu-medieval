/**
 * Weather and time-of-day captures (J5, brief §9.11 and §13): the battle map at night, at dusk,
 * in the rain and in fog (?weather=&hour= fix the conditions), from two of its views.
 * Requires the dev server (npm run dev). Writes docs/captures/<date>-<tag>/<case>-<view>.png.
 * Usage: node scripts/capture-weather.ts [tag]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { baseUrl, launch, VIEWPORT } from './browser.ts';

interface Hooks {
  __battleCamera?: { viewIds(): string[]; setView(id: string): void };
}
const tag = process.argv[2] ?? 'j5-weather-v1';
const outDir = join('docs/captures', `${new Date().toISOString().slice(0, 10)}-${tag}`);
mkdirSync(outDir, { recursive: true });
const cases = [
  { name: 'night', q: 'weather=clear&hour=22' },
  { name: 'dusk', q: 'weather=clear&hour=20' },
  { name: 'rain', q: 'weather=rain&hour=13' },
  { name: 'fog', q: 'weather=fog&hour=10' },
];
const browser = await launch();
const errors: string[] = [];
try {
  for (const c of cases) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(`${c.name}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${c.name}: ${m.text()}`);
    });
    await page.goto(`${baseUrl()}/battle?e2e&seed=siege-1&${c.q}`);
    await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && Boolean((window as unknown as Hooks).__battleCamera), undefined, { timeout: 180_000 });
    const ids = await page.evaluate(() => (window as unknown as Hooks).__battleCamera?.viewIds() ?? []);
    for (const id of ids.filter((v) => v === 'castle' || v === 'overview' || v === 'village').slice(0, 2)) {
      await page.evaluate((v) => (window as unknown as Hooks).__battleCamera?.setView(v), id);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: join(outDir, `${c.name}-${id}.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('errors:', errors.length, errors.slice(0, 5).join(' | '));
