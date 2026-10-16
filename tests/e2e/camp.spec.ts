import { expect, test, type Page } from '@playwright/test';

/**
 * The host's tents between two sieges (ADR-049): the banners' marcs buy a provision, the castle's
 * letter and the battle's briefing carry it, a siege fought to its end uses it up, and the mire
 * heals a companion for his fee. Progress is seeded in localStorage ('siege.campaign.v1').
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const SCENE_READY_TIMEOUT_MS = 120_000;
/** The garrison's turn at ?fast, then the end of the battle. */
const AI_TURN_TIMEOUT_MS = 90_000;
const CAMPAIGN_KEY = 'siege.campaign.v1';
/** A screen's code loads at its first visit (a chunk of its own), which the dev server compiles then. */
const SCREEN_TIMEOUT_MS = 30_000;
/** Roche-Grise taken with two banners: 20 marcs in the coffer (campaign.json camp.perBanner = 10). */
const PROGRESS = {
  version: 3,
  conquered: { 'roche-grise': { banners: { taken: true, swift: true, spared: false, feat: false }, stratagem: 'lettres', turns: 12 } },
  resting: ['heroArcher'],
  tutorialDone: true,
  prologueSeen: true,
  spent: 0,
  pending: [],
  failed: {},
};

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function seed(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => window.localStorage.setItem(key!, value!), [CAMPAIGN_KEY, JSON.stringify(PROGRESS)]);
}

const saved = (page: Page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null') as typeof PROGRESS, CAMPAIGN_KEY);
const provision = (page: Page, name: string) => page.locator('.tents__list li', { hasText: name });

test('the banners’ marcs buy a provision: the letter and the briefing carry it, a siege fought to its end uses it up', async ({ page }) => {
  const errors = trackErrors(page);
  await seed(page);
  await page.goto('/campagne');
  await page.getByRole('button', { name: 'Les tentes de l’ost' }).click();
  await expect(page.locator('.tents__purse')).toContainText('20 marcs d’argent');
  await provision(page, 'L’ost payé').getByRole('button', { name: 'Acheter' }).click();
  await expect(page.locator('.tents__purse')).toContainText('10 marcs d’argent');
  await expect(provision(page, 'L’ost payé').getByRole('button', { name: 'Rendre' })).toBeVisible();
  // Twenty marcs: no more in the coffer.
  await expect(provision(page, 'Des armes fourbies').getByRole('button', { name: 'Acheter' })).toBeDisabled();

  await page.locator('[data-castle="moulins"] .map-castle__ribbon').click();
  await expect(page.locator('.letter__tents')).toContainText('l’ost emportera l’ost payé');

  // The briefing tells it (a battle as a player opens it).
  await page.goto('/battle?fast&nosound&level=moulins');
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  await expect(page.locator('.hud-briefing')).toContainText('Apporté des tentes : l’ost payé.');

  // A lost assault (?turns=1: the garrison holds one round) uses it up, and is counted.
  await page.goto('/battle?e2e&fast&turns=1&level=moulins');
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  await page.evaluate(() => window.__battle!.issue({ type: 'endTurn' }));
  await page.waitForFunction(() => window.__battle!.state().status !== 'ongoing', undefined, { timeout: AI_TURN_TIMEOUT_MS });
  await expect.poll(async () => (await saved(page)).pending).toEqual([]);
  expect(await saved(page)).toMatchObject({ spent: 10, failed: { moulins: 1 } });
  expect(errors).toEqual([]);
});

test('the mire heals a companion for his fee: she is fit for the next siege', async ({ page }) => {
  const errors = trackErrors(page);
  await seed(page);
  await page.goto('/campagne');
  await expect(page.locator('.letter__resting')).toContainText('Aude se remet de ses blessures', { timeout: SCREEN_TIMEOUT_MS });
  await page.getByRole('button', { name: 'Les tentes de l’ost' }).click();
  await expect(page.locator('.tents__mire')).toContainText('Aude se remet de ses blessures');
  await page.getByRole('button', { name: /Faire venir le mire/ }).click();
  await expect(page.locator('.tents__mire')).toHaveCount(0);
  await expect(page.locator('.tents__purse')).toContainText('10 marcs d’argent');
  expect(await saved(page)).toMatchObject({ resting: [], spent: 10 });
  await page.getByRole('button', { name: '← Le Val d’Orle' }).click();
  await expect(page.locator('.letter__resting')).toHaveCount(0);
  expect(errors).toEqual([]);
});
