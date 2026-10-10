/**
 * Captures the campaign's screens (J6) in docs/captures/: the title menu, the campaign map (new
 * and with castles taken), a castle's letter, the council of war with a plan sealed, the options,
 * the trial battle with Guillaume's lesson, and a campaign battle's briefing.
 * Usage: node scripts/capture-campaign.ts [tag]   (dev server on :5188, or SIEGE_URL)
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { baseUrl, launch, VIEWPORT } from './browser.ts';

const tag = process.argv[2] ?? 'j6';
const OUT = 'docs/captures';
mkdirSync(OUT, { recursive: true });

/** A campaign with the first two castles taken (banners won), Aude resting. */
const PROGRESS = {
  conquered: {
    'roche-grise': { banners: { taken: true, swift: true, spared: false }, stratagem: 'lettres', turns: 12 },
    moulins: { banners: { taken: true, swift: false, spared: true }, stratagem: 'catapulte', turns: 17 },
  },
  resting: ['heroArcher'],
  tutorialDone: true,
  prologueSeen: true,
};

async function shot(page: Page, name: string): Promise<void> {
  const file = `${OUT}/${tag}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}

const browser = await launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${baseUrl()}/`);
await page.getByRole('heading', { name: 'Siège' }).waitFor();
await page.waitForTimeout(1000);
await shot(page, 'title');

await page.getByRole('button', { name: /Campagne/ }).click();
await page.locator('.campaign-map').waitFor();
await page.waitForTimeout(800);
await shot(page, 'map-new');
await page.locator('[data-castle="roche-grise"] .map-castle__ribbon').click();
await page.waitForTimeout(500);
await shot(page, 'letter');
await page.getByRole('button', { name: 'Réunir le conseil de guerre' }).click();
await page.locator('.scout-plan canvas').first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(600);
await shot(page, 'council');
await page.locator('.plan-card').nth(1).click();
await page.waitForTimeout(700);
await shot(page, 'council-plan');

// A campaign further on: two castles taken, a hero resting.
await page.evaluate((p) => window.localStorage.setItem('siege.campaign.v1', JSON.stringify(p)), PROGRESS);
await page.goto(`${baseUrl()}/campagne`);
await page.locator('.campaign-map').waitFor();
await page.waitForTimeout(800);
await shot(page, 'map-progress');
await page.locator('[data-castle="brumefond"] .map-castle__ribbon').click();
await page.getByRole('button', { name: 'Réunir le conseil de guerre' }).click();
await page.locator('.scout-plan canvas').first().waitFor({ timeout: 60_000 });
await page.locator('.plan-card').nth(2).click();
await page.waitForTimeout(700);
await shot(page, 'council-resting');

await page.goto(`${baseUrl()}/options`);
await page.getByRole('heading', { name: 'Options' }).waitFor();
await page.waitForTimeout(500);
await shot(page, 'options');

await page.goto(`${baseUrl()}/battle?tutorial`);
await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: 120_000 });
await page.locator('.tutorial').waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);
await shot(page, 'tutorial');

await page.goto(`${baseUrl()}/battle?level=brumefond&plan=lances`);
await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: 120_000 });
await page.waitForTimeout(2000);
await shot(page, 'briefing');

await browser.close();
if (errors.length > 0) console.log(`errors:\n${errors.join('\n')}`);
