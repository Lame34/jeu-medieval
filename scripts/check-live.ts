/**
 * Checks the deployed game after a push to main (Vercel builds it from GitHub): the page serves
 * the same bundle as the local build, the SPA's paths load directly, a campaign battle reaches
 * its scene, and nothing fails on the way (page errors, console errors, HTTP 4xx/5xx).
 * Usage: node scripts/check-live.ts [https://jeu-medieval.vercel.app]   (after `npm run build`, to compare bundles)
 */
import { existsSync, readFileSync } from 'node:fs';
import { launch, VIEWPORT } from './browser.ts';

const URL = (process.argv[2] ?? 'https://jeu-medieval.vercel.app').replace(/\/$/, '');
const SCENE_TIMEOUT_MS = 180_000;
/** The opening shot plays before the briefing shows. */
const BRIEFING_TIMEOUT_MS = 15_000;
const BUNDLE = /\/assets\/index-[\w-]+\.js/;

const problems: string[] = [];
const live = (await (await fetch(`${URL}/`)).text()).match(BUNDLE)?.[0];
const local = existsSync('dist/index.html') ? readFileSync('dist/index.html', 'utf8').match(BUNDLE)?.[0] : undefined;
console.log(`bundle live ${live ?? '?'}${local ? ` · local ${local}${live === local ? ' (same)' : ' (DIFFERENT: not deployed yet, or the local build is older)'}` : ''}`);

const browser = await launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
page.on('pageerror', (e) => problems.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
});
await page.goto(`${URL}/`);
await page.getByRole('heading', { name: 'Siège' }).waitFor();
console.log('title screen ok');
await page.goto(`${URL}/campagne`);
await page.locator('.campaign-map').waitFor();
console.log('/campagne loads directly');
await page.goto(`${URL}/options`);
await page.getByRole('heading', { name: 'Options' }).waitFor();
console.log('/options loads directly');
const t0 = Date.now();
await page.goto(`${URL}/battle?level=roche-grise&plan=lettres&nosound`);
await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: SCENE_TIMEOUT_MS });
console.log(`battle scene ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.locator('.hud-briefing').waitFor({ timeout: BRIEFING_TIMEOUT_MS });
console.log('briefing after the opening shot');
await browser.close();
console.log(problems.length > 0 ? `PROBLEMS:\n${problems.join('\n')}` : 'no errors');
process.exitCode = problems.length > 0 ? 1 : 0;
