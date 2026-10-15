import { expect, test, type Page } from '@playwright/test';

/** Errors that are not ours: dev-only deprecation chatter from dependencies (see smoke.spec.ts). */
const IGNORED = [/THREE\.Clock/, /toNonIndexed/, /glGetProgramiv/];

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORED.some((re) => re.test(msg.text()))) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** Generous: worldgen runs in a worker, then the chunked 512 m terrain + castle kit compile their shaders. */
const SCENE_READY_TIMEOUT_MS = 120_000;

async function waitForBattleReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && window.__perf?.ready === true, undefined, {
    timeout: SCENE_READY_TIMEOUT_MS,
  });
}

// Brief §7 / ADR-007 budgets (Portable preset), checked per view below.
const DRAW_CALL_BUDGET = 150;
const TRIANGLE_BUDGET = 1_500_000;

// The brief's < 10 s load budget is measured on the production build by `npm run bench:perf`
// (5.4–5.5 s cold since 02/10, docs/PERF_LOG.md « Chargement de la bataille »). This suite runs
// against a fresh, unbundled Vite dev server: its own webServer per run transforms every module on
// first request, and React StrictMode builds every useMemo twice. That measures ~10 s on a warm dev
// server and ~16 s on the suite's cold one. 20 s here catches a broken or runaway load without
// chasing dev-server-only costs. The test runs alone, before the rest of the suite (the
// 'load-budget' project of playwright.config.ts): timed among other browsers, it measured them.
const LOAD_BUDGET_MS = 20_000;
const WORLDGEN_BUDGET_MS = 10_000;

// Camera settle time before sampling renderer.info for a view (scripts/perf-bench.ts warms up
// 2500 ms before a full measurement pass; this smoke check only needs the scene to have rendered
// a few frames at the new angle).
const VIEW_SETTLE_MS = 1500;

test('battle map boots on hardware WebGL2, within the load and worldgen budgets, no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  const started = Date.now();
  await page.goto('/battle?bench');
  await waitForBattleReady(page);
  const elapsedMs = Date.now() - started;

  const perf = await page.evaluate(() => ({ gpu: window.__perf?.gpu ?? '', webgl2: window.__perf?.webgl2 ?? false }));
  expect(perf.webgl2).toBe(true);
  expect(perf.gpu).not.toMatch(/swiftshader/i);

  const worldgenMs = await page.evaluate(() => document.body.dataset['worldgenMs']);
  expect(worldgenMs).toBeDefined();
  expect(Number(worldgenMs)).toBeGreaterThan(0);
  expect(Number(worldgenMs)).toBeLessThan(WORLDGEN_BUDGET_MS);

  expect(elapsedMs).toBeLessThan(LOAD_BUDGET_MS);
  expect(errors).toEqual([]);
});

test('every camera view stays within the draw-call and triangle budgets (ADR-007)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/battle?bench');
  await waitForBattleReady(page);

  const viewCount = await page.evaluate(() => (window.__perf?.control['viewCount'] as () => number)());
  expect(viewCount).toBeGreaterThan(0);

  for (let i = 0; i < viewCount; i++) {
    await page.evaluate((index) => (window.__perf?.control['setView'] as (n: number) => void)(index), i);
    await page.waitForTimeout(VIEW_SETTLE_MS);
    const info = await page.evaluate(() => window.__perf?.renderer());
    expect(info?.calls ?? Number.POSITIVE_INFINITY, `view ${i}: draw calls`).toBeLessThan(DRAW_CALL_BUDGET);
    expect(info?.triangles ?? Number.POSITIVE_INFINITY, `view ${i}: triangles`).toBeLessThan(TRIANGLE_BUDGET);
  }
  expect(errors).toEqual([]);
});

test('a specific seed and castle layout (?seed=&castle=) boots without error', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/battle?bench&seed=siege-2&castle=3');
  await waitForBattleReady(page);
  const perf = await page.evaluate(() => ({ webgl2: window.__perf?.webgl2 ?? false }));
  expect(perf.webgl2).toBe(true);
  expect(errors).toEqual([]);
});
