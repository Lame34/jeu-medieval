import { expect, test, type Page } from '@playwright/test';

/**
 * A battle left unfinished is taken up (J7): after an order the battle is saved in the browser;
 * coming back, the game asks to take it up or start again, the title menu offers it first, and a
 * battle taken up skips its briefing (no « another version » notice: the orders replayed exactly).
 * Runs with ?fast but without ?e2e: test hooks off, saving on, as for a player.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const SCENE_READY_TIMEOUT_MS = 120_000;
const ORDER_TIMEOUT_MS = 15_000;
const SAVE_KEY = 'siege.battle.v1';
const BATTLE = '/battle?fast&nosound&seed=siege-1&castle=1';
/** Pixels below the screen centre (where Tab recentres the unit) clicked as a short move order. */
const MOVE_CLICK_OFFSET_PX = 90;
/** Camera easing after Tab, ms. */
const CAMERA_EASE_MS = 1500;

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const sceneReady = (page: Page) => page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
const savedBattle = (page: Page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null') as { title: string; turn: number; commands: unknown[] } | null, SAVE_KEY);

/** Opens the skirmish and gives one order (a short move), which saves the battle. */
async function startAndOrder(page: Page): Promise<void> {
  await page.goto(BATTLE);
  await sceneReady(page);
  await page.locator('.hud-briefing').getByRole('button', { name: 'Compris' }).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.hud-unit')).toBeVisible();
  await page.waitForTimeout(CAMERA_EASE_MS);
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  await page.mouse.click(vp.width / 2, vp.height / 2 + MOVE_CLICK_OFFSET_PX);
  await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, SAVE_KEY, { timeout: ORDER_TIMEOUT_MS });
}

test('a battle left after an order is saved, offered again, and taken up without its briefing', async ({ page }) => {
  const errors = trackErrors(page);
  await startAndOrder(page);
  const save = await savedBattle(page);
  expect(save).toMatchObject({ title: 'Escarmouche', turn: 1 });
  expect(save?.commands.length).toBeGreaterThan(0);

  // Back on the same battle: the question first.
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Une bataille était en cours' });
  await expect(dialog).toContainText('Escarmouche');
  await expect(dialog).toContainText('tour 1');
  await dialog.getByRole('button', { name: 'Reprendre la bataille' }).click();
  await sceneReady(page);
  // Taken up exactly: no briefing, no « another version » notice, the save still there.
  await expect(page.locator('.hud-banner')).toContainText('Tour 1');
  await expect(page.locator('.hud-briefing')).toHaveCount(0);
  await expect(page.locator('.hud-notice')).toHaveCount(0);
  expect(await savedBattle(page)).not.toBeNull();

  // The title menu offers it first.
  await page.goto('/');
  await expect(page.locator('.title-menu__label').first()).toHaveText('Reprendre la bataille');
  await expect(page.locator('.title-menu__item').first()).toContainText('Escarmouche, au tour 1');
  expect(errors).toEqual([]);
});

test('starting the saved battle again forgets the save and opens on the briefing', async ({ page }) => {
  const errors = trackErrors(page);
  await startAndOrder(page);
  await page.reload();
  await page.getByRole('dialog').getByRole('button', { name: 'Recommencer depuis le début' }).click();
  await sceneReady(page);
  await expect(page.locator('.hud-briefing')).toBeVisible();
  expect(await savedBattle(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('a damaged save is ignored: the battle simply starts', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.setItem(key, '{"version":1,"key":"skirmish:siege-1:1","commands":"abîmé"'), SAVE_KEY);
  await page.reload();
  await expect(page.locator('.title-menu__label').first()).toHaveText('Bataille d’essai');
  await page.goto(BATTLE);
  await sceneReady(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.hud-briefing')).toBeVisible();
  expect(errors).toEqual([]);
});
