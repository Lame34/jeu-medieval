import { expect, test, type Page } from '@playwright/test';

/**
 * Orders for several men (ADR-044): a frame drawn on the field chooses the men inside it, Shift
 * and a click adds or removes one, a click on the ground walks them all in rank, Escape lets them
 * go.
 */

const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];
const SCENE_READY_TIMEOUT_MS = 120_000;
const ORDER_TIMEOUT_MS = 20_000;
const BATTLE = '/battle?e2e&fast&nosound&level=roche-grise&plan=lettres';
const FOOT = ['soldier', 'archer', 'knight'];
/** The frame overlaps the men's marks by this much (px), and the walk goes this far north (m). */
const FRAME_MARGIN_PX = 15;
const WALK_NORTH_M = 20;
/** A man has moved once he stands this far from where he was (m). */
const MOVED_M = 1;

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

test('a frame chooses the men, Shift and a click takes one out, a click walks them in rank', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(BATTLE);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined' && typeof window.__battleCamera !== 'undefined', undefined, { timeout: SCENE_READY_TIMEOUT_MS });
  const ours = (await units(page)).filter((u) => u.faction === 'attacker' && FOOT.includes(u.typeKey));
  const middle = { x: ours.reduce((s, u) => s + u.position.x, 0) / ours.length, z: ours.reduce((s, u) => s + u.position.z, 0) / ours.length };
  await page.evaluate(([x, z]) => window.__battleCamera!.look({ focus: { x, z }, distance: 70, yawTurns: 0, pitchDeg: 62 }), [middle.x, middle.z] as const);
  await page.waitForTimeout(1200);
  const marks = await Promise.all(ours.map((u) => page.evaluate((id) => window.__battle!.unitScreen(id), u.id)));
  if (marks.some((m) => !m)) throw new Error('fixture: a man is off screen');
  const xs = marks.map((m) => m!.x);
  const ys = marks.map((m) => m!.y);

  // The frame, drawn with the button held down.
  await page.mouse.move(Math.min(...xs) - FRAME_MARGIN_PX, Math.min(...ys) - FRAME_MARGIN_PX);
  await page.mouse.down();
  await page.mouse.move(Math.max(...xs) + FRAME_MARGIN_PX, Math.max(...ys) + FRAME_MARGIN_PX, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.hud-group h2')).toHaveText(`${ours.length} hommes choisis`);

  // Shift and a click on one of them: he leaves the group.
  const out = marks[0]!;
  await page.keyboard.down('Shift');
  await page.mouse.click(out.x, out.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('.hud-group h2')).toHaveText(`${ours.length - 1} hommes choisis`);

  // A click on the ground: the others walk, the one left out stays.
  const goal = await page.evaluate(([x, z]) => window.__battle!.groundScreen(x, z), [middle.x, middle.z - WALK_NORTH_M] as const);
  await page.mouse.move(goal.x, goal.y);
  await expect(page.locator('.hud-preview')).toContainText('En rang');
  await page.mouse.click(goal.x, goal.y);
  await expect
    .poll(async () => {
      const now = await units(page);
      return ours.filter((u) => {
        const v = now.find((x) => x.id === u.id);
        return v !== undefined && Math.hypot(v.position.x - u.position.x, v.position.z - u.position.z) > MOVED_M;
      }).length;
    }, { timeout: ORDER_TIMEOUT_MS })
    .toBe(ours.length - 1);
  const left = (await units(page)).find((u) => u.id === ours[0]!.id);
  expect(left?.position).toEqual(ours[0]!.position);

  await page.keyboard.press('Escape');
  await expect(page.locator('.hud-group')).toBeHidden();
  expect(errors).toEqual([]);
});
