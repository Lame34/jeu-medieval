import { expect, test, type Page } from '@playwright/test';

/**
 * The illuminated chronicle (ADR-050): it opens from the campaign once a castle has fallen; each
 * chapter is told from the deeds of its battle, under a miniature and a gilded initial drawn by
 * the game; a castle taken before the deeds were kept is told from what is known; the book prints.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const CAMPAIGN_KEY = 'siege.campaign.v1';
/** A screen's code loads at its first visit (a chunk of its own), which the dev server compiles then. */
const SCREEN_TIMEOUT_MS = 30_000;
const ALL = { taken: true, swift: true, spared: true, feat: true };
/** Roche-Grise yielded to the herald; Moulins-sur-Orle taken before the chronicle was kept. */
const PROGRESS = {
  version: 3,
  conquered: {
    'roche-grise': {
      banners: ALL,
      stratagem: 'lettres',
      turns: 9,
      deeds: { banners: ALL, stratagem: 'lettres', rank: 'knight', provisions: ['paie'], wounded: [], assault: 1, ending: 'summoned', turns: 9, turnLimit: 22, lost: 0, slain: 3, garrison: 9, breaches: 1, mined: 0, gate: false, portcullis: false, drawbridge: true, burned: [], filled: 0, climbed: 0, captain: true },
    },
    moulins: { banners: { taken: true, swift: false, spared: true, feat: false }, stratagem: null, turns: 18 },
  },
  resting: [],
  tutorialDone: true,
  prologueSeen: true,
  spent: 10,
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

test('no chronicle before a castle has fallen', async ({ page }) => {
  await page.goto('/campagne');
  await expect(page.locator('.campaign-bar')).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  await expect(page.getByRole('button', { name: 'La chronique' })).toHaveCount(0);
});

test('the chronicle tells each castle taken from its deeds, under a miniature, and prints', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.evaluate(([key, value]) => window.localStorage.setItem(key!, value!), [CAMPAIGN_KEY, JSON.stringify(PROGRESS)]);
  await page.goto('/campagne');
  await page.getByRole('button', { name: 'La chronique' }).click();
  await expect(page).toHaveURL(/\/chronique$/);
  await page.locator('.chronicle').waitFor({ timeout: SCREEN_TIMEOUT_MS });

  await expect(page.locator('.chronicle h1')).toHaveText('La chronique de la guerre du Félon');
  await expect(page.locator('.chronicle__incipit')).toContainText('Ci commence la chronique');
  const chapters = page.locator('.chronicle__chapter');
  await expect(chapters).toHaveCount(2);
  const roche = chapters.first();
  await expect(roche.locator('h2')).toHaveText('Roche-Grise, la sentinelle du nord');
  await expect(roche.getByRole('img', { name: 'Miniature : le siège de Roche-Grise' })).toBeVisible();
  await expect(roche.locator('.chronicle__lettrine')).toBeVisible();
  await expect(roche).toContainText('que tenait sire Aymon le Prudent');
  await expect(roche).toContainText('Les hommes avaient été payés de ce qui leur était dû.');
  await expect(roche).toContainText('Le mangonneau ouvrit une brèche dans la muraille.');
  await expect(roche).toContainText('Le héraut somma la garnison de rendre le château');
  await expect(roche).toContainText('L’ost n’y perdit pas un homme.');
  await expect(roche).toContainText('Ainsi s’étaient rendus Falaise, Caen et Rouen');
  await expect(chapters.nth(1)).toContainText('Le clerc qui suivait l’ost n’a pas laissé le récit de ce siège.');
  await expect(page.locator('.chronicle__explicit')).toContainText('la guerre n’est pas finie');

  // The browser's print dialog, asked for (stubbed: a test cannot answer it).
  await page.evaluate(() => {
    window.print = () => document.body.setAttribute('data-printed', 'true');
  });
  await page.getByRole('button', { name: 'Imprimer la chronique' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'true');
  await page.getByRole('button', { name: '← La carte' }).click();
  await expect(page).toHaveURL(/\/campagne$/);
  expect(errors).toEqual([]);
});
