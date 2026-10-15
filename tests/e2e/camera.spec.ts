import { expect, test, type Page } from '@playwright/test';

/**
 * The camera on a laptop's touchpad (ADR-042): two fingers sliding pan the view, a pinch (a wheel
 * with Ctrl) zooms, a mouse wheel notch zooms; the buttons under the mini-map turn, zoom and bring
 * the view back on our men; a right click (a two-finger tap) cancels the choice.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const SCENE_READY_TIMEOUT_MS = 120_000;
const BATTLE = '/battle?e2e&fast&nosound&level=roche-grise&plan=lettres';
/** A camera clear of the HUD, looking down on the army. */
const OVERVIEW = { distance: 60, yawTurns: 0, pitchDeg: 55 } as const;
/** A slide of two fingers on a touchpad: small pixel steps, a little sideways. */
const SLIDE = { dx: 0.5, dy: 12.5, steps: 12 } as const;
/** A pinch: Ctrl and small vertical steps (spreading the fingers zooms in). */
const PINCH = { dy: -6, steps: 10 } as const;
/** A mouse wheel notch, as Chromium sends it. */
const NOTCH_PX = 100;
/** The view settles (damped) within this tolerance: metres, and turns. */
const SETTLED_M = 0.5;
const ONE_BUTTON_TURN = 1 / 16;
const SETTLE_MS = 1200;

interface View {
  readonly focus: { readonly x: number; readonly z: number };
  readonly distance: number;
  readonly yawTurns: number;
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const view = async (page: Page): Promise<View> => {
  const v = await page.evaluate(() => window.__battleCamera!.view());
  if (!v) throw new Error('no camera view');
  return v;
};

/** The view once the damping has caught up (TacticalCamera's DAMPING of 7 per second: within 1e-3 after a second). */
async function settled(page: Page): Promise<View> {
  await page.waitForTimeout(SETTLE_MS);
  return view(page);
}

async function open(page: Page, pointer?: 'mouse' | 'touchpad'): Promise<void> {
  if (pointer) await page.addInitScript((p) => localStorage.setItem('siege.settings.v1', JSON.stringify({ pointer: p })), pointer);
  await page.goto(BATTLE);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined' && typeof window.__battleCamera !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  const army = await page.evaluate(() => window.__battle!.state().units.filter((u) => u.faction === 'attacker').map((u) => u.position));
  const at = army[0];
  if (!at) throw new Error('fixture: no army');
  await page.evaluate(([x, z, v]) => window.__battleCamera!.look({ focus: { x, z }, ...v }), [at.x, at.z, OVERVIEW] as const);
  await settled(page);
  // The pointer over the field, clear of the HUD's cards.
  const box = page.viewportSize();
  await page.mouse.move((box?.width ?? 0) / 2, (box?.height ?? 0) / 3);
}

test('two fingers slide the view, a pinch brings it nearer, and the guess holds', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page);
  const before = await settled(page);
  for (let i = 0; i < SLIDE.steps; i++) await page.mouse.wheel(SLIDE.dx, SLIDE.dy);
  const slid = await settled(page);
  expect(Math.hypot(slid.focus.x - before.focus.x, slid.focus.z - before.focus.z)).toBeGreaterThan(SETTLED_M);
  expect(slid.distance).toBeCloseTo(before.distance, 1);

  await page.keyboard.down('Control');
  for (let i = 0; i < PINCH.steps; i++) await page.mouse.wheel(0, PINCH.dy);
  await page.keyboard.up('Control');
  const pinched = await settled(page);
  expect(pinched.distance).toBeLessThan(slid.distance - SETTLED_M);
  expect(Math.hypot(pinched.focus.x - slid.focus.x, pinched.focus.z - slid.focus.z)).toBeLessThan(SETTLED_M);

  // Once the wheels came from a touchpad, a big step still pans (a fast slide, not a mouse notch).
  await page.mouse.wheel(0, NOTCH_PX);
  const fast = await settled(page);
  expect(fast.distance).toBeCloseTo(pinched.distance, 1);
  expect(errors).toEqual([]);
});

test('a mouse wheel notch zooms, and the option keeps it so', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'mouse');
  const before = await settled(page);
  await page.mouse.wheel(0, NOTCH_PX);
  const after = await settled(page);
  expect(after.distance).toBeGreaterThan(before.distance + SETTLED_M);
  expect(Math.hypot(after.focus.x - before.focus.x, after.focus.z - before.focus.z)).toBeLessThan(SETTLED_M);
  // Sideways deltas do not turn a mouse into a touchpad when the option says mouse.
  await page.mouse.wheel(SLIDE.dx, SLIDE.dy);
  const still = await settled(page);
  expect(Math.hypot(still.focus.x - after.focus.x, still.focus.z - after.focus.z)).toBeLessThan(SETTLED_M);
  expect(errors).toEqual([]);
});

test('the buttons under the mini-map turn, zoom and bring the view back; a right click cancels', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'touchpad');
  const before = await settled(page);
  await page.getByRole('button', { name: 'Pivoter vers la gauche' }).click();
  const turned = await settled(page);
  expect(turned.yawTurns - before.yawTurns).toBeCloseTo(ONE_BUTTON_TURN, 2);
  await page.getByRole('button', { name: 'Rapprocher la vue' }).click();
  const nearer = await settled(page);
  expect(nearer.distance).toBeLessThan(turned.distance - SETTLED_M);

  // Away from the army, the last button brings the view back on its middle.
  await page.evaluate(() => {
    const v = window.__battleCamera!.view()!;
    window.__battleCamera!.look({ ...v, focus: { x: v.focus.x + 80, z: v.focus.z + 80 } });
  });
  await page.getByRole('button', { name: 'Revenir sur vos hommes' }).click();
  const home = await settled(page);
  const centre = await page.evaluate(() => {
    const ours = window.__battle!.state().units.filter((u) => u.faction === 'attacker' && u.alive);
    return { x: ours.reduce((s, u) => s + u.position.x, 0) / ours.length, z: ours.reduce((s, u) => s + u.position.z, 0) / ours.length };
  });
  expect(Math.hypot(home.focus.x - centre.x, home.focus.z - centre.z)).toBeLessThan(SETTLED_M);

  // A man chosen (Tab), then a right click on the field: the choice is undone.
  await page.mouse.move((page.viewportSize()?.width ?? 0) / 2, (page.viewportSize()?.height ?? 0) / 3);
  await page.keyboard.press('Tab');
  await expect(page.locator('.hud-unit')).toBeVisible();
  await page.mouse.click((page.viewportSize()?.width ?? 0) / 2, (page.viewportSize()?.height ?? 0) / 3, { button: 'right' });
  await expect(page.locator('.hud-unit')).toBeHidden();
  expect(errors).toEqual([]);
});
