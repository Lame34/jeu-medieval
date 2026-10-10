import { expect, test, type Page } from '@playwright/test';

/**
 * The campaign (J6) end to end: the title menu, the campaign map (locked, open and taken castles),
 * a castle's letter, the council of war and its sealed plan carried into the battle, the
 * chronicle of a defeat and the way back to the map, the options kept across a reload,
 * Guillaume’s lessons in the trial battle, and a battle's opening shot. Progress lives in
 * localStorage ('siege.campaign.v1'); each test starts from a fresh browser context.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const SCENE_READY_TIMEOUT_MS = 120_000;
/** The scouts' plan waits on the map's generation in a worker. */
const PLAN_TIMEOUT_MS = 60_000;
/** The garrison's turn at ?fast, then the end of the battle. */
const AI_TURN_TIMEOUT_MS = 90_000;
const CAMPAIGN_KEY = 'siege.campaign.v1';
const SETTINGS_KEY = 'siege.settings.v1';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** A castle on the map, clicked by its name ribbon (the waving flag never moves it). */
const castle = (page: Page, id: string) => page.locator(`[data-castle="${id}"]`);
const openCastle = (page: Page, id: string) => page.locator(`[data-castle="${id}"] .map-castle__ribbon`).click();

async function waitForBattle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
}

test('the title menu leads with the trial battle, then the campaign', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  const entries = page.locator('.title-menu__label');
  await expect(entries).toHaveText(['Bataille d’essai', 'Campagne', 'Escarmouche', 'Options']);
  await expect(page.locator('.title-menu__mark')).toHaveText('Commencez ici');
  await page.getByRole('button', { name: /Campagne/ }).click();
  await expect(page).toHaveURL(/\/campagne$/);
  expect(errors).toEqual([]);
});

test('a new campaign: the first castle open, the others locked, the fort a lesson', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/campagne');
  await expect(castle(page, 'roche-grise')).toHaveClass(/map-castle--open/);
  for (const id of ['moulins', 'brumefond', 'pierre-ardente', 'haute-garde']) await expect(castle(page, id)).toHaveClass(/map-castle--locked/);
  await expect(castle(page, 'fortin')).toHaveClass(/map-castle--open/);
  await expect(page.locator('.campaign-bar__progress')).toContainText('Châteaux 0 / 5');
  // A locked castle's letter says which castle opens the road.
  await openCastle(page, 'moulins');
  await expect(page.locator('.letter__locked')).toContainText('Prenez d’abord Roche-Grise');
  expect(errors).toEqual([]);
});

test('the council seals a plan, and the battle starts as the plan says', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/campagne?e2e&fast');
  await openCastle(page, 'roche-grise');
  await expect(page.locator('.letter__title')).toHaveText('Roche-Grise');
  await page.getByRole('button', { name: 'Réunir le conseil de guerre' }).click();
  const march = page.getByRole('button', { name: /Sceller le plan et marcher sur Roche-Grise/ });
  await expect(march).toBeDisabled();
  await expect(page.locator('.plan-card')).toHaveCount(3);
  await page.locator('.scout-plan canvas').first().waitFor({ timeout: PLAN_TIMEOUT_MS });
  // Key 2: Bertrand's plan — a causeway laid overnight, a round lost.
  await page.keyboard.press('2');
  await expect(page.locator('.plan-card').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.council__foot p')).toContainText('Bertrand');
  await march.click();
  await expect(page).toHaveURL(/\/battle\?.*level=roche-grise.*plan=fascines/);
  await waitForBattle(page);
  const state = await page.evaluate(() => window.__battle!.state());
  expect(state.turnLimit).toBe(23);
  expect(state.works.filter((w) => w.done)).toHaveLength(1);
  await expect(page.getByRole('button', { name: /Carte/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a lost assault: the chronicle, then back to the map with the castle still to take', async ({ page }) => {
  const errors = trackErrors(page);
  // ?turns=1: the garrison only has to hold one round.
  await page.goto('/battle?e2e&fast&turns=1&level=roche-grise&plan=aube');
  await waitForBattle(page);
  expect((await page.evaluate(() => window.__battle!.state())).startHour).toBe(6);
  await page.evaluate(() => window.__battle!.issue({ type: 'endTurn' }));
  await page.waitForFunction(() => window.__battle!.state().status !== 'ongoing', undefined, { timeout: AI_TURN_TIMEOUT_MS });
  const end = page.locator('.hud-end');
  await expect(end.locator('h2')).toHaveText('L’assaut a échoué');
  await expect(end).toContainText('Roche-Grise tient bon');
  await expect(end).toContainText('Guillaume');
  await end.getByRole('button', { name: 'Retour à la carte' }).click();
  await expect(page).toHaveURL(/\/campagne/);
  await expect(castle(page, 'roche-grise')).toHaveClass(/map-castle--open/);
  expect(errors).toEqual([]);
});

test('castles taken are sealed, the next one opens, a wounded hero rests', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.evaluate(
    ([key]) =>
      window.localStorage.setItem(
        key!,
        JSON.stringify({ conquered: { 'roche-grise': { banners: { taken: true, swift: true, spared: false }, stratagem: 'lettres', turns: 12 } }, resting: ['heroArcher'], tutorialDone: true, prologueSeen: true }),
      ),
    [CAMPAIGN_KEY],
  );
  await page.reload();
  await expect(page.locator('.title-menu__mark')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Campagne/ })).toContainText('1 château sur 5');
  await page.getByRole('button', { name: /Campagne/ }).click();
  await expect(castle(page, 'roche-grise')).toHaveClass(/map-castle--taken/);
  await expect(castle(page, 'moulins')).toHaveClass(/map-castle--open/);
  await expect(castle(page, 'brumefond')).toHaveClass(/map-castle--locked/);
  await expect(page.locator('.campaign-bar__progress')).toContainText('Étendards 2 / 15');
  await expect(page.locator('.letter__resting')).toContainText('Aude se remet de ses blessures');
  await openCastle(page, 'moulins');
  await page.getByRole('button', { name: 'Réunir le conseil de guerre' }).click();
  // Aude rests: her plan cannot be chosen.
  await expect(page.locator('.plan-card').first()).toBeDisabled();
  await expect(page.locator('.plan-card').nth(2)).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.council')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the options are kept across a reload, and the campaign can be wiped', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/options');
  await page.getByRole('radiogroup', { name: 'Qualité' }).getByRole('radio', { name: 'Haut' }).click();
  await page.getByRole('radiogroup', { name: 'Animations' }).getByRole('radio', { name: '×2' }).click();
  await page.getByRole('radiogroup', { name: 'Confirmer la fin du tour' }).getByRole('radio', { name: 'Non' }).click();
  await page.reload();
  await expect(page.getByRole('radiogroup', { name: 'Qualité' }).getByRole('radio', { name: 'Haut' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radiogroup', { name: 'Animations' }).getByRole('radio', { name: '×2' })).toHaveAttribute('aria-checked', 'true');
  const saved = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as Record<string, unknown>, SETTINGS_KEY);
  expect(saved).toMatchObject({ quality: 'high', animation: 'fast', confirmEndTurn: false });
  // Wiping the campaign asks twice.
  await page.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ conquered: { 'roche-grise': { banners: { taken: true, swift: false, spared: false }, stratagem: null, turns: 20 } }, resting: [], tutorialDone: true, prologueSeen: true })), CAMPAIGN_KEY);
  await page.reload();
  const wipe = page.getByRole('button', { name: /Effacer la progression/ });
  await wipe.click();
  await expect(page.getByRole('button', { name: /Vraiment/ })).toBeVisible();
  await page.getByRole('button', { name: /Vraiment/ }).click();
  await expect(page.getByText('La campagne repart de zéro')).toBeVisible();
  const progress = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? '{}') as { conquered?: object }, CAMPAIGN_KEY);
  expect(progress.conquered).toEqual({});
  await page.getByRole('button', { name: /Rétablir les options/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Qualité' }).getByRole('radio', { name: 'Portable' })).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('the trial battle: Guillaume’s lessons tick off as the player acts', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/battle?e2e&fast&tutorial');
  await waitForBattle(page);
  const lesson = page.locator('.tutorial');
  await expect(lesson).toContainText('Leçon 1 / 15');
  await expect(lesson.locator('h2')).toHaveText('Bienvenue au Fortin du Gué');
  // The same battle every time: the fort's seed, a clear morning, thirty rounds.
  const state = await page.evaluate(() => window.__battle!.state());
  expect(state).toMatchObject({ weather: 'clear', startHour: 10, turnLimit: 30 });
  await lesson.getByRole('button', { name: /Commencer/ }).click();
  await expect(lesson.locator('h2')).toHaveText('Regarder le terrain');
  await expect(page.locator('body')).toHaveAttribute('data-tutorial-highlight', 'minimap');
  await lesson.getByRole('button', { name: /Passer/ }).click();
  await expect(lesson.locator('h2')).toHaveText('Choisir une unité');
  // Selecting one of ours ticks the lesson off, and the next follows: one in the middle of the
  // view (clear of the minimap, the lesson and the banner).
  const viewport = page.viewportSize()!;
  const spots = await page.evaluate((ids) => ids.map((id) => window.__battle!.unitScreen(id)), state.units.filter((u) => u.faction === 'attacker').map((u) => u.id));
  const at = spots.find((p) => p !== null && p.x > viewport.width * 0.25 && p.x < viewport.width * 0.7 && p.y > viewport.height * 0.2 && p.y < viewport.height * 0.8);
  expect(at).toBeDefined();
  await page.mouse.click(at!.x, at!.y);
  await expect(lesson.locator('.tutorial__goal')).toHaveAttribute('data-done', 'true');
  await expect(lesson.locator('h2')).toHaveText('Se déplacer', { timeout: 5_000 });
  // Hidden, the lesson waits on a tab.
  await lesson.getByRole('button', { name: 'Masquer' }).click();
  await expect(page.locator('.tutorial-tab')).toContainText('Leçon 4 / 15');
  expect(errors).toEqual([]);
});

test('a campaign battle opens on the castle, then the army; a key cuts the shot short and the briefing follows', async ({ page }) => {
  const errors = trackErrors(page);
  // Neither ?e2e nor ?fast: the establishing shot plays.
  await page.goto('/battle?nosound&level=roche-grise&plan=lettres');
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  // Held on the castle: the briefing waits for the shot.
  await expect(page.locator('.hud-briefing')).toHaveCount(0);
  // The garrison's count and where it gives up, in the banner.
  await expect(page.locator('.hud-garrison-chip')).toContainText(/Garnison \d+ · se rend à \d/);
  await page.keyboard.press('Shift');
  await expect(page.locator('.hud-briefing')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.hud-briefing')).toContainText(/hommes? debout, elle se rend/);
  expect(errors).toEqual([]);
});
