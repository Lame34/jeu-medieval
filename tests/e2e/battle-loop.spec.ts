import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end battle loop (J3): selection, the hover preview, move-by-click, overwatch, order
 * rejection and turn hand-off to the AI, all driven through `window.__battle` (installed by
 * BattleDirector under `?e2e`; see tests/e2e/globals.d.ts for its shape). `?fast` plays queued
 * animations at 8x so tests don't sit through walk/attack clips in real time.
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

/** Same budget as tests/e2e/battle.spec.ts: worldgen runs in a worker, then shaders compile. */
const SCENE_READY_TIMEOUT_MS = 120_000;
/** The AI's whole turn at `?fast` (planning, plus every move/attack/guard animation at 8x). */
const AI_TURN_TIMEOUT_MS = 60_000;
/** A single player order's animation (one move or one guard) at 8x. */
const ORDER_TIMEOUT_MS = 15_000;
/** One frame of slack for a synchronous, no-animation state change (a rejection) to clear `busy`. */
const INSTANT_TIMEOUT_MS = 5_000;
/** Viewport margin (px) that keeps a hover point clear of TacticalCamera's edge-scroll band
 * (`EDGE_PX = 14` in src/render/camera/TacticalCamera.tsx), so hovering never pans the camera and
 * shifts the point we just computed out from under the pointer. */
const EDGE_SAFE_MARGIN_PX = 60;
/** Roughly the "~10 m" hover point the brief asks for. */
const HOVER_OFFSET_M = 10;
/** Well outside the ~512 m battle map, for a `to` that is always rejected as `outOfBounds`
 * regardless of seed, unit or AP (checked before any pathing in src/core/battle/movement.ts). */
const FAR_OUTSIDE_MAP_M = 100_000;
/** Fixed seed: deterministic map, deployment and unit roster (src/core/worldgen/battle.ts fixes
 * the attacker roster's order — `['knight', 'soldier', 'archer', …]` — independently of the seed,
 * only positions and terrain vary with it). */
const SEED = 'e2e-battle-loop';

/** The label BattleHud's journal prints for a rejected order (src/ui/battle/describe.ts
 * `REJECTION_LABEL`). Duplicated here rather than imported, like the rest of this file's
 * knowledge of the app: tests/e2e's tsconfig doesn't include src (see globals.d.ts). */
const OUT_OF_BOUNDS_LABEL = 'Hors de la carte.';

async function waitForBattleReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof window.__battle !== 'undefined', undefined, {
    timeout: SCENE_READY_TIMEOUT_MS,
  });
}

async function waitUntilIdle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(() => window.__battle !== undefined && !window.__battle.busy(), undefined, { timeout: timeoutMs });
}

async function battleState(page: Page): Promise<TestBattleState> {
  return page.evaluate(() => window.__battle!.state());
}

async function issue(page: Page, command: TestCommand): Promise<void> {
  await page.evaluate((c) => window.__battle!.issue(c), command);
}

/**
 * Tab, with nothing selected, always selects the first alive attacker unit with AP or an action
 * left, in id order (`onKey` 'Tab' in src/render/battle/BattleDirector.tsx: `at` is -1 when
 * `selectedId` is null, so `next = ours[0]`). `BattleState.units` is sorted by id (core invariant,
 * src/core/battle/types.ts), so this is deterministic for a given seed.
 */
function firstSelectable(battle: TestBattleState): TestUnitState {
  const unit = battle.units.find((u) => u.faction === 'attacker' && u.alive && (u.ap > 0 || u.actions > 0));
  if (!unit) throw new Error('fixture assumption broken: no selectable attacker unit at battle start');
  return unit;
}

/** A ranged attacker that can still stand guard (`canOverwatch`, src/core/battle/overwatch.ts:
 * any unit with a ranged attack). The roster has several (two archers among others); any one
 * will do. */
function firstReadyArcher(battle: TestBattleState): TestUnitState {
  const unit = battle.units.find((u) => u.faction === 'attacker' && u.typeKey === 'archer' && u.alive && u.ap > 0 && u.actions > 0);
  if (!unit) throw new Error('fixture assumption broken: no ready attacker archer at battle start');
  return unit;
}

const HOVER_CANDIDATES: ReadonlyArray<TestVec2> = [
  { x: HOVER_OFFSET_M, z: 0 },
  { x: -HOVER_OFFSET_M, z: 0 },
  { x: 0, z: HOVER_OFFSET_M },
  { x: 0, z: -HOVER_OFFSET_M },
  { x: HOVER_OFFSET_M, z: HOVER_OFFSET_M },
  { x: -HOVER_OFFSET_M, z: -HOVER_OFFSET_M },
];

/** Consecutive near-identical samples that mean the camera has stopped easing. */
const CAMERA_STABLE_SAMPLES = 5;
const CAMERA_STABLE_TOLERANCE_PX = 0.25;
const CAMERA_POLL_INTERVAL_MS = 50;

/**
 * Tab recentres the camera with damping (`focusOn`, TacticalCamera DAMPING), so every screen
 * projection drifts for a moment: a point computed during the ease no longer matches the ray cast
 * a moment later (this was the cause of previewed cost != spent cost). Wait until a unit's screen
 * position has stopped moving before computing pointer coordinates.
 */
async function waitForCameraSettled(page: Page, unitId: string): Promise<void> {
  let stable = 0;
  let last: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const now = await page.evaluate((id) => window.__battle!.unitScreen(id), unitId);
        if (now && last && Math.hypot(now.x - last.x, now.y - last.y) <= CAMERA_STABLE_TOLERANCE_PX) stable++;
        else stable = 0;
        last = now;
        return stable >= CAMERA_STABLE_SAMPLES;
      },
      { message: 'camera never settled after Tab', timeout: ORDER_TIMEOUT_MS, intervals: [CAMERA_POLL_INTERVAL_MS] },
    )
    .toBe(true);
}

/**
 * Waits for two animation frames. `pointermove` updates the hover store synchronously
 * (src/render/battle/BattleDirector.tsx `refreshHover`), but React only commits that to the DOM
 * on a later frame; without this, reading `.hud-preview` right after `page.mouse.move` can race
 * and return the *previous* hover's text paired with the *new* target's coordinates.
 */
async function settleFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * A point roughly `HOVER_OFFSET_M` from `unit` that the game accepts as a move (hovering it
 * shows an AP cost, not a rejection) and that projects well clear of the camera's edge-scroll
 * band. The deployment field is mostly open, but tries a few directions rather than assuming
 * any one is clear — robust to map/seed changes. Requires `unit` to already be selected (Tab or
 * a click): the preview only renders for a selected unit (BattleHud.tsx).
 */
async function findMoveTarget(page: Page, unit: TestUnitState): Promise<{ world: TestVec2; screen: { x: number; y: number }; previewText: string }> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport configured for this page');
  for (const offset of HOVER_CANDIDATES) {
    const world: TestVec2 = { x: unit.position.x + offset.x, z: unit.position.z + offset.z };
    const screen = await page.evaluate((w) => window.__battle!.groundScreen(w.x, w.z), world);
    const clearOfEdges =
      screen.x > EDGE_SAFE_MARGIN_PX &&
      screen.y > EDGE_SAFE_MARGIN_PX &&
      screen.x < viewport.width - EDGE_SAFE_MARGIN_PX &&
      screen.y < viewport.height - EDGE_SAFE_MARGIN_PX;
    if (!clearOfEdges) continue;
    await page.mouse.move(screen.x, screen.y);
    await settleFrame(page);
    const blocked = await page.locator('.hud-preview .hud-blocked').count();
    if (blocked > 0) continue;
    const previewText = await page.locator('.hud-preview').innerText();
    if (/\bPA\b/.test(previewText)) return { world, screen, previewText };
  }
  throw new Error(`no reachable, on-screen move target found within ${HOVER_OFFSET_M} m of unit "${unit.id}"`);
}

test('Tab selects a unit, hovering ~10 m previews the AP cost, and clicking spends exactly that', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/battle?e2e&fast&seed=${SEED}`);
  await waitForBattleReady(page);

  const before = firstSelectable(await battleState(page));

  await page.keyboard.press('Tab');
  await expect(page.locator('.hud-unit')).toBeVisible();
  await waitForCameraSettled(page, before.id);

  const target = await findMoveTarget(page, before);
  const spentMatch = /(\d+)\s*PA/.exec(target.previewText);
  expect(spentMatch, `no "N PA" cost in the preview: ${JSON.stringify(target.previewText)}`).not.toBeNull();
  const apSpent = Number((spentMatch as RegExpExecArray)[1]);

  await page.mouse.click(target.screen.x, target.screen.y);
  await waitUntilIdle(page, ORDER_TIMEOUT_MS);

  const after = (await battleState(page)).units.find((u) => u.id === before.id);
  expect(after, `unit "${before.id}" vanished from state() after moving`).toBeDefined();
  const moved = after as TestUnitState;
  const distanceMoved = Math.hypot(moved.position.x - before.position.x, moved.position.z - before.position.z);
  expect(distanceMoved, 'the unit did not move').toBeGreaterThan(1);
  expect(moved.ap, 'AP spent did not match the previewed cost').toBe(before.ap - apSpent);
  expect(errors).toEqual([]);
});

test('an archer can stand guard, and an impossible order is rejected, logged, and changes nothing', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/battle?e2e&fast&seed=${SEED}`);
  await waitForBattleReady(page);

  // Orders go straight through `issue()` (bypassing Tab/click): the brief flags this as the
  // safer route for the guard order, and command application never depends on HUD selection
  // (src/core/commands/apply.ts), so it also exercises the same code path a click would.
  const archer = firstReadyArcher(await battleState(page));
  await issue(page, { type: 'overwatch', unitId: archer.id, direction: { x: 1, z: 0 } });
  await waitUntilIdle(page, ORDER_TIMEOUT_MS);

  const guarded = (await battleState(page)).units.find((u) => u.id === archer.id);
  expect(guarded?.overwatch, 'overwatch was not set').not.toBeNull();
  await expect(page.locator('.hud-log')).toContainText('monte la garde');

  // A move far outside the map is always rejected (`outOfBounds`, checked before pathing/AP in
  // src/core/battle/movement.ts), regardless of seed, unit or AP — a deterministic "impossible
  // order" independent of terrain.
  const before = firstSelectable(await battleState(page));
  await issue(page, { type: 'move', unitId: before.id, to: { x: FAR_OUTSIDE_MAP_M, z: FAR_OUTSIDE_MAP_M } });
  await waitUntilIdle(page, INSTANT_TIMEOUT_MS);

  const after = (await battleState(page)).units.find((u) => u.id === before.id);
  expect(after).toEqual(before);
  await expect(page.locator('.hud-log')).toContainText(OUT_OF_BOUNDS_LABEL);
  expect(errors).toEqual([]);
});

test('ending the turn hands it to the AI, and it comes back to the attackers', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`/battle?e2e&fast&seed=${SEED}`);
  await waitForBattleReady(page);

  const initial = await battleState(page);
  expect(initial.activeFaction).toBe('attacker');

  await page.keyboard.press('Enter');
  // `issue()` applies synchronously (src/ui/battle/session.ts): the turn has already changed
  // hands before any animation (the turn banner) has played a single frame.
  expect((await battleState(page)).activeFaction).toBe('defender');

  await waitUntilIdle(page, AI_TURN_TIMEOUT_MS);

  const after = await battleState(page);
  expect(after.status, `battle ended early (${after.status}); adjust the scenario if this seed is meant to reach turn 2`).toBe('ongoing');
  expect(after.activeFaction).toBe('attacker');
  expect(after.turn).toBe(initial.turn + 1);
  await expect(page.locator('.hud-log')).toContainText(/Tour \d+ :/);
  expect(errors).toEqual([]);
});

test('replaying the same commands on a fresh page with the same seed gives the same final state', async ({ page }) => {
  await page.goto(`/battle?e2e&fast&seed=${SEED}`);
  await waitForBattleReady(page);

  const initial = await battleState(page);
  const mover = firstSelectable(initial);
  const archer = firstReadyArcher(initial);
  // Verified reachable through the same hover preview a player would see (scenario above),
  // rather than assumed: the script below must be a script two sessions can both execute. The
  // preview only renders for a selected unit (BattleHud.tsx), hence the Tab.
  await page.keyboard.press('Tab');
  await waitForCameraSettled(page, mover.id);
  const target = await findMoveTarget(page, mover);
  const script: readonly TestCommand[] = [
    { type: 'move', unitId: mover.id, to: target.world },
    { type: 'overwatch', unitId: archer.id, direction: { x: 1, z: 0 } },
    { type: 'move', unitId: mover.id, to: { x: FAR_OUTSIDE_MAP_M, z: FAR_OUTSIDE_MAP_M } }, // rejected, on purpose
  ];

  for (const command of script) await issue(page, command);
  const finalA = await battleState(page);

  const page2 = await page.context().newPage();
  await page2.goto(`/battle?e2e&fast&seed=${SEED}`);
  await waitForBattleReady(page2);
  for (const command of script) await issue(page2, command);
  const finalB = await battleState(page2);
  await page2.close();

  // Full structural equality (not just the units this script touched): the core is deterministic
  // end to end for a given seed + scenario + command log (CLAUDE.md), so nothing should differ —
  // including the RNG state carried inside `state()`.
  expect(finalB).toEqual(finalA);
});
