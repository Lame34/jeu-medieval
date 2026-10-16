import { expect, test, type Page } from '@playwright/test';

/**
 * The words of the siege (ADR-046): the lexicon lists them with their age; in the game's texts,
 * a period word is underlined and gives its meaning on hover or focus.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
/** The lexicon ships at least this many words. */
const MIN_WORDS = 20;
/** A screen's code loads at its first visit (a chunk of its own), which the dev server compiles then. */
const SCREEN_TIMEOUT_MS = 30_000;

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test('the lexicon lists the words of the siege, each with its meaning and its age', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Lexique/ }).click();
  await expect(page.getByRole('heading', { name: 'Lexique du siège' })).toBeVisible({ timeout: SCREEN_TIMEOUT_MS });
  expect(await page.locator('.lexicon__entry').count()).toBeGreaterThanOrEqual(MIN_WORDS);
  const mouton = page.locator('.lexicon__entry').filter({ has: page.locator('dt', { hasText: /^Mouton$/ }) });
  await expect(mouton).toContainText('bélier');
  await expect(mouton).toContainText('1155');
  expect(errors).toEqual([]);
});

test('a period word in a castle’s letter gives its meaning on hover', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/campagne?e2e');
  await page.locator('[data-castle="roche-grise"] .map-castle__ribbon').click({ timeout: SCREEN_TIMEOUT_MS });
  const word = page.locator('.letter__story .term').first();
  await expect(word).toBeVisible();
  // The note is drawn over the whole page: found by the id the word points to.
  const tip = page.locator(`[id="${await word.getAttribute('aria-describedby')}"]`);
  await expect(tip).toBeHidden();
  await word.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Attesté');
  expect(errors).toEqual([]);
});
