import { expect, test, type Page } from '@playwright/test';

/**
 * Approach and strike (J7), by the mouse as a player does it: a click on an enemy out of reach
 * walks the man to where he can strike or shoot from this turn, then attacks; too far for this
 * turn, the game says so plainly and nothing moves. A walk too long for this turn goes as far as
 * it can; a man looked at before any is chosen shows his card.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const SCENE_READY_TIMEOUT_MS = 120_000;
const ORDER_TIMEOUT_MS = 15_000;
/** Roche-Grise, Aude's plan: the outpost's militia stands about 41 m from the first archer, 44 m from the first knight. */
const BATTLE = '/battle?e2e&fast&nosound&level=roche-grise&plan=lettres';
/** A camera high and far enough to hold both men on screen. */
const OVERVIEW = { distance: 95, yawTurns: 0, pitchDeg: 62 } as const;
/** The point walked to stops this short of the enemy (m): clear of him, beyond a knight's turn. */
const SHORT_OF_FOE_M = 5;
/** A knight's whole turn on the best road: 4 points of action at 8 m (src/data). */
const KNIGHT_TURN_M = 32;

interface Unit {
  readonly id: string;
  readonly typeKey: string;
  readonly faction: string;
  readonly alive: boolean;
  readonly position: { readonly x: number; readonly z: number };
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

const units = (page: Page) => page.evaluate(() => window.__battle!.state().units as unknown as Unit[]);
const screenOf = (page: Page, id: string) => page.evaluate((u) => window.__battle!.unitScreen(u), id);
const far = (a: Unit, b: Unit) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

/** Opens the battle, frames our first `typeKey` and the nearest enemy, selects ours by a click. */
async function select(page: Page, typeKey: string): Promise<{ me: Unit; foe: Unit }> {
  await page.goto(BATTLE);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  const all = await units(page);
  const me = all.find((u) => u.faction === 'attacker' && u.typeKey === typeKey);
  if (!me) throw new Error(`fixture: no ${typeKey} in the army`);
  const foe = all.filter((u) => u.faction === 'defender').reduce((best, u) => (far(me, u) < far(me, best) ? u : best));
  await page.evaluate(([x, z, view]) => window.__battleCamera!.look({ focus: { x, z }, ...view }), [(me.position.x + foe.position.x) / 2, (me.position.z + foe.position.z) / 2, OVERVIEW] as const);
  await page.waitForTimeout(800);
  const at = await screenOf(page, me.id);
  if (!at) throw new Error('fixture: our man is off screen');
  // Looked at before he is chosen: his card, which never takes the pointer from him.
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.hud-preview')).toContainText('des vôtres');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.hud-unit')).toBeVisible();
  return { me, foe };
}

test('an archer out of range walks up, then shoots: one click', async ({ page }) => {
  const errors = trackErrors(page);
  const { me, foe } = await select(page, 'archer');
  const at = await screenOf(page, foe.id);
  if (!at) throw new Error('fixture: the enemy is off screen');
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.hud-preview')).toContainText('S’approcher');
  await expect(page.locator('.hud-preview')).toContainText('puis tirer');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.hud-log')).toContainText('Archer attaque', { timeout: ORDER_TIMEOUT_MS });
  const after = (await units(page)).find((u) => u.id === me.id);
  expect(after && far(after, me)).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('a knight too far for this turn is told so plainly, and stays where he is', async ({ page }) => {
  const errors = trackErrors(page);
  const { me, foe } = await select(page, 'knight');
  const at = await screenOf(page, foe.id);
  if (!at) throw new Error('fixture: the enemy is off screen');
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.hud-preview')).toContainText('Trop loin pour l’atteindre ce tour');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.hud-log')).toContainText('Trop loin pour l’atteindre ce tour : avancez d’abord.');
  const after = (await units(page)).find((u) => u.id === me.id);
  expect(after?.position).toEqual(me.position);
  expect(errors).toEqual([]);
});

test('a walk too long for this turn goes as far as it can, toward the point asked', async ({ page }) => {
  const errors = trackErrors(page);
  const { me, foe } = await select(page, 'knight');
  const d = far(me, foe);
  const goal = { x: foe.position.x + ((me.position.x - foe.position.x) * SHORT_OF_FOE_M) / d, z: foe.position.z + ((me.position.z - foe.position.z) * SHORT_OF_FOE_M) / d };
  const at = await page.evaluate(([x, z]) => window.__battle!.groundScreen(x, z), [goal.x, goal.z] as const);
  if (!at) throw new Error('fixture: the point is off screen');
  await page.mouse.move(at.x, at.y);
  await expect(page.locator('.hud-preview')).toContainText('Trop loin pour ce tour');
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await units(page)).find((u) => u.id === me.id)?.position, { timeout: ORDER_TIMEOUT_MS }).not.toEqual(me.position);
  const after = (await units(page)).find((u) => u.id === me.id);
  if (!after) throw new Error('the knight is gone');
  // Nearer the point asked, by no more than a turn's walk.
  expect(far(after, { ...me, position: goal })).toBeLessThan(far(me, { ...me, position: goal }));
  expect(far(after, me)).toBeLessThanOrEqual(KNIGHT_TURN_M);
  expect(errors).toEqual([]);
});
