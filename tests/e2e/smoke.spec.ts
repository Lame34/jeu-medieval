import { expect, test, type Page } from '@playwright/test';

/** Errors that are not ours: dev-only deprecation chatter from dependencies. */
const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test('title screen renders with the game font and menu', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Siège' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Atelier du peintre/ })).toBeEnabled();
  const titleFont = await page.getByRole('heading', { name: 'Siège' }).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(titleFont).toContain('Cinzel');
  expect(errors).toEqual([]);
});

test('look-dev scene boots on hardware WebGL2 without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/lookdev?bench');
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && window.__perf?.ready === true, undefined, { timeout: 90_000 });
  const perf = await page.evaluate(() => ({ gpu: window.__perf?.gpu ?? '', webgl2: window.__perf?.webgl2 ?? false, info: window.__perf?.renderer() }));
  expect(perf.webgl2).toBe(true);
  expect(perf.gpu).not.toMatch(/swiftshader/i);
  expect(perf.info?.calls ?? 0).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('menu navigation reaches the look-dev screen and back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Atelier du peintre/ }).click();
  await expect(page).toHaveURL(/\/lookdev$/);
  await page.getByRole('button', { name: /Retour/ }).click();
  await expect(page.getByRole('heading', { name: 'Siège' })).toBeVisible();
});
