import { expect, test, type Page } from '@playwright/test';

/**
 * The campaign's months (ADR-052): each castle's letter tells its month and what it changes (April's
 * soaked ground, October's morning mist and harvested fields); a siege's banner opens on its month,
 * and October's mist is gone once its hour is past.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const CAMPAIGN_KEY = 'siege.campaign.v1';
/** A screen's code loads at its first visit (a chunk of its own), which the dev server compiles then. */
const SCREEN_TIMEOUT_MS = 30_000;
const SCENE_READY_TIMEOUT_MS = 120_000;
const TAKEN = { banners: { taken: true, swift: false, spared: false, feat: false }, stratagem: null, turns: 20 };
/** The four castles before Haute-Garde taken: its letter opens. */
const PROGRESS = {
  version: 3,
  conquered: { 'roche-grise': TAKEN, moulins: TAKEN, brumefond: TAKEN, 'pierre-ardente': TAKEN },
  tutorialDone: true,
  prologueSeen: true,
};

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const openCastle = (page: Page, id: string) => page.locator(`[data-castle="${id}"] .map-castle__ribbon`).click();

test('each castle’s letter tells its month and what it changes', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.evaluate(([key, value]) => window.localStorage.setItem(key!, value!), [CAMPAIGN_KEY, JSON.stringify(PROGRESS)]);
  await page.goto('/campagne');
  await expect(page.locator('.campaign-bar')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });

  await openCastle(page, 'roche-grise');
  await expect(page.locator('.letter__season')).toContainText('Avril. Les pluies du printemps ont détrempé la terre');
  await expect(page.locator('.campaign-letter')).toContainText('Terre détrempée : on y avance moins vite');

  await openCastle(page, 'haute-garde');
  await expect(page.locator('.letter__season')).toContainText('Octobre. Après la moisson');
  const letter = page.locator('.campaign-letter');
  await expect(letter).toContainText('Brouillas du matin : on ne voit qu’à 50 m jusqu’à 9 h 15');
  await expect(letter).toContainText('Champs moissonnés : le chaume ne cache plus personne');
  await expect(letter).toContainText('Assaut à 8 h');

  await openCastle(page, 'brumefond');
  await expect(page.locator('.letter__epithet')).toContainText('le château des brouillas');
  await expect(letter).toContainText('Brouillas : on ne voit qu’à 30 m');
  await expect(letter).not.toContainText(/brouillard|brume\b/i);
  expect(errors).toEqual([]);
});

test('Haute-Garde is besieged on an October morning, in a mist that has lifted by 9 h 30', async ({ page }) => {
  const errors = trackErrors(page);
  const chip = page.locator('.hud-conditions-chip');
  await page.goto('/battle?e2e&fast&nosound&level=haute-garde');
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  expect((await page.evaluate(() => window.__battle!.state())).season).toBe('october');
  await expect(chip).toHaveText(/^Octobre · 8 h 00 · Brouillas · Vent/);

  // The same siege at 9 h 30 (?hour=): the mist has lifted.
  await page.goto('/battle?e2e&fast&nosound&level=haute-garde&hour=9.5');
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  await expect(chip).toHaveText(/^Octobre · 9 h 30 · Ciel clair · Vent/);
  expect(errors).toEqual([]);
});
