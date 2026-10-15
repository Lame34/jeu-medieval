import { expect, test, type Page } from '@playwright/test';

/**
 * « Que ferait Guillaume ? » (ADR-043): the card's button (or C) shows the old knight's advice for
 * the chosen man, in a sentence; Escape puts it away; following it gives his orders.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const SCENE_READY_TIMEOUT_MS = 120_000;
const ORDER_TIMEOUT_MS = 15_000;
const BATTLE = '/battle?e2e&fast&nosound&level=roche-grise&plan=lettres';
/** Tab goes through our men: enough presses to reach any of them. */
const MAX_TABS = 30;

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** Chooses our first man named `name` with Tab, the pointer resting over the field. */
async function choose(page: Page, name: string): Promise<void> {
  await page.goto(BATTLE);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  await page.mouse.move((page.viewportSize()?.width ?? 0) / 2, (page.viewportSize()?.height ?? 0) / 3);
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    const title = (await page.locator('.hud-unit h2').textContent()) ?? '';
    if (title.startsWith(name)) return;
  }
  throw new Error(`fixture: no ${name} in the army`);
}

test('the advice is told, put away with Escape, and followed with a second C', async ({ page }) => {
  const errors = trackErrors(page);
  await choose(page, 'Archer');
  const before = await page.evaluate(() => window.__battle!.state().units.filter((u) => u.faction === 'attacker').map((u) => ({ id: u.id, ap: u.ap, actions: u.actions })));
  await page.keyboard.press('KeyC');
  const card = page.locator('.hud-advice');
  await expect(card).toContainText('Conseil de Guillaume');
  await expect(card.locator('p')).toContainText(/\.\s*»$/);
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.locator('.hud-unit')).toBeVisible();

  await page.keyboard.press('KeyC');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Suivre le conseil/ }).click();
  await expect(card).toBeHidden();
  await expect
    .poll(async () => {
      const after = await page.evaluate(() => window.__battle!.state().units.filter((u) => u.faction === 'attacker').map((u) => ({ id: u.id, ap: u.ap, actions: u.actions })));
      return after.some((u) => {
        const b = before.find((x) => x.id === u.id);
        return b !== undefined && (u.ap < b.ap || u.actions < b.actions);
      });
    }, { timeout: ORDER_TIMEOUT_MS })
    .toBe(true);
  expect(errors).toEqual([]);
});
