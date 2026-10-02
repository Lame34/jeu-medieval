/**
 * Sappers' works captures (J4): the siege park's sapper walks to the moat, fills a slot with
 * fascines (two turns), crosses the causeway and undermines the curtain behind it (three turns)
 * until it collapses. Targets are computed here from the same seed as the page; the page plays
 * real commands through the `?e2e` hook. Requires the dev server (npm run dev).
 * The garrison passes its turns. Writes docs/captures/<date>-<tag>/works-*.png.
 * Usage: node scripts/capture-works.ts [tag] [--seed siege-1] [--headed]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { createBattleContext } from '../src/core/battle/context.ts';
import { fillSiteAt, moatsOf } from '../src/core/battle/moat.ts';
import { cellIndexOf } from '../src/core/battle/create.ts';
import { initialStructures, planStructures, syncNav } from '../src/core/battle/structures.ts';
import type { WorkState } from '../src/core/battle/types.ts';
import { findPath } from '../src/core/nav-grid/pathfinding.ts';
import { projectOnPolyline } from '../src/core/worldgen/geometry.ts';
import { generateBattleMap } from '../src/core/worldgen/battle.ts';
import { DEFAULT_RULES } from '../src/data/index.ts';
import { baseUrl, launch, VIEWPORT } from './browser.ts';

interface Point {
  readonly x: number;
  readonly z: number;
}
interface Hooks {
  __battle?: {
    state(): { turn: number; activeFaction: string; units: { id: string; alive: boolean; position: Point }[]; works: { id: string; progress: number; done: boolean }[]; structures: { id: string; broken: boolean }[] };
    issue(c: unknown): { rejection: string | null };
    busy(): boolean;
  };
  __battleCamera?: { look(v: { focus: Point; distance: number; yawTurns: number; pitchDeg: number }): void };
}

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};
const tag = args[0] && !args[0].startsWith('--') ? args[0] : 'works';
const seed = option('seed', 'siege-1');
const SAPPER = 'att-siege-2';
const MAX_TURNS = 12;
const date = new Date().toISOString().slice(0, 10);
const outDir = join('docs', 'captures', `${date}-${tag}`);
mkdirSync(outDir, { recursive: true });

// --- Targets, from the same map as the page -----------------------------------------------------
const { layout, castle } = generateBattleMap({ seed, castleIndex: 1 });
const ctx = createBattleContext(layout.terrain, DEFAULT_RULES, layout.deck, planStructures(layout, DEFAULT_RULES.structures), moatsOf(layout));
const sapperStart = layout.units.find((u) => u.id === SAPPER)?.position;
if (!sapperStart) throw new Error(`no ${SAPPER} on this map`);
const moat = ctx.moats[0];
if (!moat) throw new Error('no moat');
const ringCentre = { x: castle.ring.reduce((a, p) => a + p.x, 0) / castle.ring.length, z: castle.ring.reduce((a, p) => a + p.z, 0) / castle.ring.length };
// The curtain segment whose outer moat lies nearest to the sapper, away from the gate.
const walls = ctx.structures.filter((d) => d.kind === 'wall' && d.cells.length > 40);
const wall = walls.reduce((best, d) => (Math.hypot(d.center.x - sapperStart.x, d.center.z - sapperStart.z) < Math.hypot(best.center.x - sapperStart.x, best.center.z - sapperStart.z) ? d : best));
const outward = (() => {
  const dx = wall.center.x - ringCentre.x;
  const dz = wall.center.z - ringCentre.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
})();
const moatPoint = projectOnPolyline({ x: wall.center.x + outward.x * 11, z: wall.center.z + outward.z * 11 }, moat.centerline).point;
const site = fillSiteAt(ctx, moatPoint);
const snap = (p: Point) => ({ x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 });
const bank = snap({ x: moatPoint.x + outward.x * 7.5, z: moatPoint.z + outward.z * 7.5 });
const foot = snap({ x: wall.center.x + outward.x * 2.2, z: wall.center.z + outward.z * 2.2 });
// From outside the walls, looking in.
const viewYaw = Math.atan2(-outward.x, -outward.z) / (2 * Math.PI) + 0.5;
console.log(`wall ${wall.id} · fill site ${site} · bank ${bank.x},${bank.z} · foot ${foot.x},${foot.z}`);

// --- Driving the page ------------------------------------------------------------------------------
const hooks = (page: Page) => page;
const state = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__battle?.state());
const issue = (page: Page, command: unknown) =>
  page.evaluate((c) => {
    const b = (window as unknown as Hooks).__battle;
    return b ? b.issue(c).rejection : 'noHook';
  }, command);
const idle = (page: Page) =>
  page.waitForFunction(
    () => {
      const b = (window as unknown as Hooks).__battle;
      return b ? !b.busy() && b.state().activeFaction === 'attacker' : false;
    },
    undefined,
    { timeout: 180_000 },
  );
/**
 * Ends the turn. The garrison passes its own (both turns end in the same call, before the AI
 * starts): this capture shows the works, not the sapper's chances under the walls.
 */
const endTurn = async (page: Page) => {
  await page.evaluate(() => {
    const b = (window as unknown as Hooks).__battle;
    b?.issue({ type: 'endTurn' });
    b?.issue({ type: 'endTurn' });
  });
  await page.waitForTimeout(300);
  await idle(page);
};
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(outDir, `works-${name}.png`) });
  console.log(`  ${name}`);
};
const sapperAt = async (page: Page) => (await state(page))?.units.find((u) => u.id === SAPPER)?.position ?? sapperStart;
/** Cells of the sapper's path to `goal` (the map with the structures intact, works done so far). */
const pathTo = (from: Point, goal: Point, works: readonly WorkState[]): Point[] => {
  syncNav(ctx, initialStructures(ctx.structures), works);
  const found = findPath(ctx.paths, { profile: 'lightFoot', start: cellIndexOf(ctx, from), goal: cellIndexOf(ctx, goal) });
  return (found?.cells ?? []).map((i) => ({ x: (i % ctx.nav.width) + 0.5, z: Math.floor(i / ctx.nav.width) + 0.5 }));
};
/** Walks the sapper to `goal` over turns along its path: each turn, the farthest point of it within reach. */
const walkTo = async (page: Page, goal: Point) => {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const from = await sapperAt(page);
    if (Math.hypot(from.x - goal.x, from.z - goal.z) < 1) return true;
    const path = pathTo(from, goal, (await state(page))?.works ?? []);
    let moved = false;
    for (let k = path.length - 1; k > 0 && !moved; k -= 2) moved = (await issue(page, { type: 'move', unitId: SAPPER, to: path[k] })) === null;
    await idle(page);
    const now = await sapperAt(page);
    if (Math.hypot(now.x - goal.x, now.z - goal.z) < 1) return true;
    if (!moved) console.log(`  turn ${(await state(page))?.turn}: no move (path of ${path.length} cells)`);
    await endTurn(page);
  }
  return false;
};

const browser = await launch({ headed: args.includes('--headed') });
try {
  const page = hooks(await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 }));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${baseUrl()}/battle?e2e&seed=${encodeURIComponent(seed)}`);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && Boolean((window as unknown as Hooks).__battleCamera), undefined, { timeout: 180_000 });
  const look = (focus: Point, distance: number) => page.evaluate(([f, d, y]) => (window as unknown as Hooks).__battleCamera?.look({ focus: f as Point, distance: d as number, yawTurns: y as number, pitchDeg: 32 }), [focus, distance, viewYaw] as const);

  console.log(`walking to the bank: ${(await walkTo(page, bank)) ? 'there' : 'not there'}`);
  await look(moatPoint, 30);
  await page.waitForTimeout(2000);
  await shot(page, '00-bank');
  for (let k = 0; k < 2; k++) {
    console.log(`fill ${k + 1}: ${(await issue(page, { type: 'fillMoat', unitId: SAPPER, at: moatPoint })) ?? 'ok'}`);
    await page.waitForTimeout(1600);
    await shot(page, `0${k + 1}-fascines`);
    await idle(page);
    await endTurn(page);
    await look(moatPoint, 30);
  }
  console.log(`walking to the wall foot: ${(await walkTo(page, foot)) ? 'there' : 'not there'}`);
  await look(wall.center, 34);
  await page.waitForTimeout(1500);
  await shot(page, '03-wall-foot');
  for (let k = 0; k < 3; k++) {
    const rejection = await issue(page, { type: 'undermine', unitId: SAPPER, structureId: wall.id });
    console.log(`mine ${k + 1}: ${rejection ?? 'ok'}`);
    const broken = (await state(page))?.structures.find((s) => s.id === wall.id)?.broken;
    if (broken) {
      for (const [ms, name] of [
        [1500, '06-collapse'],
        [3500, '07-breach'],
      ] as const) {
        await page.waitForTimeout(ms);
        await shot(page, name);
      }
      break;
    }
    await page.waitForTimeout(1600);
    await shot(page, `0${k + 4}-mine`);
    await idle(page);
    await endTurn(page);
    await look(wall.center, 34);
  }
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
} finally {
  await browser.close();
}
