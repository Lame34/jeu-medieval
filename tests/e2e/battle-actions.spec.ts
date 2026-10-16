import { expect, test, type Page } from '@playwright/test';

/**
 * The action bar on the selected unit's card (ADR-034): Garde, Flèche enflammée, siege works,
 * heroes' abilities; armed actions and their hover preview; the opening briefing; the folded
 * journal. Driven through `window.__battle` (installed under `?e2e`, see globals.d.ts).
 */

/** Errors that are not ours: dev-only deprecation chatter from dependencies (see battle.spec.ts). */
const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const SEED = 'siege-1';
const SCENE_READY_TIMEOUT_MS = 120_000;
const ORDER_TIMEOUT_MS = 15_000;
/** Viewport margin (px) clear of TacticalCamera's edge-scroll band (14 px). */
const EDGE_SAFE_MARGIN_PX = 60;
/** Distances (m) from the unit at which a hover point is tried for aiming an armed action. */
const AIM_OFFSETS_M: ReadonlyArray<TestVec2> = [
  { x: 8, z: 0 },
  { x: -8, z: 0 },
  { x: 0, z: 8 },
  { x: 0, z: -8 },
  { x: 5, z: 5 },
  { x: -5, z: -5 },
];
/** Hero unit id and its first ability's log line / cooldown (src/data/heroes.json: volley, 3 turns). */
const HERO_ID = 'att-hero-heroArcher';
const HERO_LOG = 'Aude : Commandement !';
/** The journal keeps this many lines (src/state/battle-ui.ts LOG_LINES). */
const LOG_LINES = 5;
const FAR_OUTSIDE_MAP_M = 100_000;
const OUT_OF_BOUNDS_LABEL = 'C’est hors du champ de bataille.';
/** Number of distinct rejections pushed to overflow the journal. */
const OVERFLOW_PUSHES = 8;

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/battle?${query}&seed=${SEED}`);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, {
    timeout: SCENE_READY_TIMEOUT_MS,
  });
}

async function state(page: Page): Promise<TestBattleState> {
  return page.evaluate(() => window.__battle!.state());
}

async function unitOf(page: Page, id: string): Promise<TestUnitState> {
  const u = (await state(page)).units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
}

async function firstOfType(page: Page, typeKey: string): Promise<TestUnitState> {
  const u = (await state(page)).units.find((x) => x.faction === 'attacker' && x.typeKey === typeKey && x.alive);
  if (!u) throw new Error(`no attacker ${typeKey} in seed ${SEED}`);
  return u;
}

async function idle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__battle !== undefined && !window.__battle.busy(), undefined, { timeout: ORDER_TIMEOUT_MS });
}

async function settleFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Camera easing after Tab (TacticalCamera damping) is over once a unit stops moving on screen, ms. */
const CAMERA_POLL_MS = 100;
const CAMERA_STABLE_SAMPLES = 5;
const CAMERA_STABLE_TOLERANCE_PX = 0.25;
/** Upper bound on Tab presses to reach a given unit (the roster is a few dozen units). */
const MAX_TABS = 80;

/**
 * Selects a unit as a player would, by clicking on its body. The unit starts off screen, so Tab
 * first walks the selection to it (recentring the camera on it), then Escape deselects and the
 * click on its body selects it again.
 */
async function selectByClick(page: Page, unit: TestUnitState, name: string): Promise<void> {
  const header = page.locator('.hud-unit h2');
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    await expect(header).toBeVisible();
    if ((await header.innerText()).startsWith(name)) break;
    if (i === MAX_TABS - 1) throw new Error(`Tab never reached ${unit.id}`);
  }
  let stable = 0;
  let last: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const now = await page.evaluate((id) => window.__battle!.unitScreen(id), unit.id);
        if (now && last && Math.hypot(now.x - last.x, now.y - last.y) <= CAMERA_STABLE_TOLERANCE_PX) stable++;
        else stable = 0;
        last = now;
        return stable >= CAMERA_STABLE_SAMPLES;
      },
      { message: 'camera never settled', timeout: ORDER_TIMEOUT_MS, intervals: [CAMERA_POLL_MS] },
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.hud-unit')).toHaveCount(0);
  const p = await page.evaluate((id) => window.__battle!.unitScreen(id), unit.id);
  if (!p) throw new Error(`unit ${unit.id} has no screen position`);
  await page.mouse.click(p.x, p.y);
  await expect(header).toBeVisible();
  await expect(header).toContainText(name);
}

function button(page: Page, label: string) {
  return page.locator('.hud-abilities button', { hasText: label });
}

/** Hovers the first on-screen ground point around the unit that satisfies `accept`; returns it. */
async function hoverAim(page: Page, unit: TestUnitState, accept: () => Promise<boolean>): Promise<{ x: number; y: number }> {
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  for (const o of AIM_OFFSETS_M) {
    const s = await page.evaluate((w) => window.__battle!.groundScreen(w.x, w.z), { x: unit.position.x + o.x, z: unit.position.z + o.z });
    if (s.x < EDGE_SAFE_MARGIN_PX || s.y < EDGE_SAFE_MARGIN_PX || s.x > vp.width - EDGE_SAFE_MARGIN_PX || s.y > vp.height - EDGE_SAFE_MARGIN_PX) continue;
    await page.mouse.move(s.x, s.y);
    await settleFrame(page);
    if (await accept()) return s;
  }
  throw new Error(`no acceptable aim point around ${unit.id}`);
}

test('Garde: armed by button, previewed on the ground, ordered by a click; Escape disarms', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'e2e&fast');
  const archer = await firstOfType(page, 'archer');
  await selectByClick(page, archer, 'Archer');

  await expect(button(page, 'Garde')).toBeVisible();
  await expect(button(page, 'Garde').locator('kbd')).toHaveText('G');
  await expect(button(page, 'Flèche enflammée')).toBeVisible();
  await expect(button(page, 'Flèche enflammée').locator('kbd')).toHaveText('B');

  // Escape disarms without any order.
  await button(page, 'Garde').click();
  await expect(button(page, 'Garde')).toHaveAttribute('data-armed', 'true');
  await page.keyboard.press('Escape');
  await expect(button(page, 'Garde')).not.toHaveAttribute('data-armed', /.*/);
  expect((await unitOf(page, archer.id)).overwatch).toBeNull();
  await expect(page.locator('.hud-unit')).toBeVisible();

  // Arm again, hover, preview, click.
  await button(page, 'Garde').click();
  await expect(button(page, 'Garde')).toHaveAttribute('data-armed', 'true');
  const aim = await hoverAim(page, archer, async () => (await page.locator('.hud-preview').innerText()).includes('Garde vers ce point'));
  await expect(page.locator('.hud-preview')).toContainText('Garde vers ce point');
  await page.mouse.click(aim.x, aim.y);
  await idle(page);
  expect((await unitOf(page, archer.id)).overwatch).not.toBeNull();
  await expect(page.locator('.hud-unit .hud-tag')).toContainText('en garde');
  await expect(button(page, 'Garde')).not.toHaveAttribute('data-armed', /.*/);
  expect(errors).toEqual([]);
});

test('the B key arms the fire arrow; a non-flammable target shows a refusal; Escape disarms', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'e2e&fast');
  const archer = await firstOfType(page, 'archer');
  await selectByClick(page, archer, 'Archer');

  await page.keyboard.press('KeyB');
  await expect(button(page, 'Flèche enflammée')).toHaveAttribute('data-armed', 'true');
  await expect(page.locator('.hud-hint')).toContainText('Visez puis cliquez');

  // The deployment field is bare ground: the fire arrow has nothing to catch.
  await hoverAim(page, archer, async () => (await page.locator('.hud-preview .hud-blocked').count()) > 0);
  await expect(page.locator('.hud-preview .hud-blocked')).not.toBeEmpty();

  await page.keyboard.press('Escape');
  await expect(button(page, 'Flèche enflammée')).not.toHaveAttribute('data-armed', /.*/);
  expect(errors).toEqual([]);
});

test('siege specialists: the sapper fills or undermines, the tower is disabled far from the walls', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'e2e&fast');

  const sapper = await firstOfType(page, 'sapper');
  await selectByClick(page, sapper, 'Mineur');
  await expect(button(page, 'Combler ou miner')).toBeVisible();
  await expect(button(page, 'Combler ou miner')).toBeEnabled();

  const tower = await firstOfType(page, 'siegeTower');
  await selectByClick(page, tower, 'Beffroi');
  await expect(button(page, 'Accoler')).toBeVisible();
  await expect(button(page, 'Accoler')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('hero: keys 1 and 2 name the abilities; 1 casts the volley at once and shows its cooldown', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'e2e&fast');
  await selectByClick(page, await unitOf(page, HERO_ID), 'Aude');

  await expect(button(page, 'Commandement')).toBeVisible();
  await expect(button(page, 'Commandement').locator('kbd')).toHaveText('1');
  await expect(button(page, 'Flèche perçante')).toBeVisible();
  await expect(button(page, 'Flèche perçante').locator('kbd')).toHaveText('2');
  await expect(button(page, 'Commandement')).toBeEnabled();

  await page.keyboard.press('Digit1');
  await idle(page);
  await expect(page.locator('.hud-log')).toContainText(HERO_LOG);
  await expect(button(page, 'Commandement')).toBeDisabled();
  await expect(button(page, 'Commandement')).toContainText('prête dans');
  expect(errors).toEqual([]);
});

/** Rounds the herald waits before he may summon again (src/data/damage.json battle.summons.cooldownRounds). */
const SUMMONS_COOLDOWN_ROUNDS = 3;

test('summons: the herald tells the chance, is refused by a fresh garrison, and must wait', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'e2e&fast');
  const summon = page.getByRole('button', { name: /Sommer la garnison/ });
  await expect(summon).toBeEnabled();
  await expect(summon).toContainText('chance qu’elle cède : 1 %, son capitaine la tient');

  await summon.click();
  await idle(page);
  await expect(page.locator('.hud-log')).toContainText('Votre héraut somme la garnison de rendre le château. Elle refuse');
  expect((await state(page)).status).toBe('ongoing');
  await expect(summon).toBeDisabled();
  await expect(summon).toContainText(`le héraut revient dans ${SUMMONS_COOLDOWN_ROUNDS} tours`);
  expect(errors).toEqual([]);
});

test('briefing: shown at turn 1 without ?e2e, closed by "Compris" and gone for good', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/battle?fast&seed=${SEED}`);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: SCENE_READY_TIMEOUT_MS });

  const briefing = page.locator('.hud-briefing');
  await expect(briefing).toBeVisible();
  await expect(briefing).toContainText('Prenez le château');
  await briefing.getByRole('button', { name: 'Compris' }).click();
  await expect(briefing).toHaveCount(0);
  await settleFrame(page);
  await expect(briefing).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** Pixels below the screen centre (where Tab recentres the unit) clicked as a short move order. */
const MOVE_CLICK_OFFSET_PX = 90;
/** Camera easing after Tab, ms. */
const CAMERA_EASE_MS = 1500;

test('briefing: a first order (a move click) closes it too', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/battle?fast&seed=${SEED}`);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  await expect(page.locator('.hud-briefing')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.hud-unit')).toBeVisible();
  await page.waitForTimeout(CAMERA_EASE_MS);
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  await page.mouse.click(vp.width / 2, vp.height / 2 + MOVE_CLICK_OFFSET_PX);
  await expect(page.locator('.hud-briefing')).toHaveCount(0, { timeout: ORDER_TIMEOUT_MS });
  expect(errors).toEqual([]);
});

test('journal: identical consecutive refusals fold into one line with a count; five lines at most', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'e2e&fast');
  const unit = await firstOfType(page, 'archer');
  const outside = { type: 'move', unitId: unit.id, to: { x: FAR_OUTSIDE_MAP_M, z: FAR_OUTSIDE_MAP_M } } as const;
  await page.evaluate((c) => window.__battle!.issue(c), outside);
  await page.evaluate((c) => window.__battle!.issue(c), outside);

  const lines = page.locator('.hud-log li');
  await expect(lines.filter({ hasText: OUT_OF_BOUNDS_LABEL })).toHaveCount(1);
  await expect(lines.filter({ hasText: OUT_OF_BOUNDS_LABEL })).toContainText('×2');

  // Distinct lines overflow it: a guard order's line alternating with the refusal never folds.
  for (let i = 0; i < OVERFLOW_PUSHES; i++) {
    await page.evaluate(
      (c) => window.__battle!.issue(c),
      i % 2 === 0 ? { type: 'attack', unitId: unit.id, targetId: 'nobody' } as const : outside,
    );
  }
  await expect(lines).toHaveCount(LOG_LINES);
  expect(errors).toEqual([]);
});
