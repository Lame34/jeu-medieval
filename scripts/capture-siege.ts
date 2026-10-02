/**
 * Siege captures (J4, brief §13): plays a scripted siege on the battle map through the `?e2e`
 * hook and screenshots it — the catapult brings down the drawbridge's winch operator, then
 * pounds a curtain segment until it collapses — before, during and after each fall.
 * Requires the dev server (npm run dev). Writes docs/captures/<date>-<tag>/siege-*.png.
 * Usage: node scripts/capture-siege.ts [tag] [--seed siege-1] [--headed]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { baseUrl, launch, VIEWPORT } from './browser.ts';

interface UnitLike {
  readonly id: string;
  readonly typeKey: string;
  readonly alive: boolean;
  readonly faction: string;
  readonly hp: number;
}
interface StateLike {
  readonly turn: number;
  readonly activeFaction: string;
  readonly status: string;
  readonly units: readonly UnitLike[];
  readonly structures: readonly { readonly id: string; readonly hp: number; readonly broken: boolean }[];
}
interface Hooks {
  __battle?: { state(): StateLike; issue(c: unknown): { rejection: string | null }; busy(): boolean };
  __battleCamera?: { setView(id: string): void; look(v: { focus: { x: number; z: number }; distance: number; yawTurns: number; pitchDeg: number }): void };
}

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};
const tag = args[0] && !args[0].startsWith('--') ? args[0] : 'siege';
const seed = option('seed', 'siege-1');
const MAX_ROUNDS = 14;
const CATAPULT = 'att-siege-1';
const OPERATOR = 'def-tower-0';
const date = new Date().toISOString().slice(0, 10);
const outDir = join('docs', 'captures', `${date}-${tag}`);
mkdirSync(outDir, { recursive: true });

const state = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__battle?.state() as StateLike);
const issue = (page: Page, command: unknown) =>
  page.evaluate((c) => {
    const b = (window as unknown as Hooks).__battle;
    return b ? b.issue(c).rejection : 'noHook';
  }, command);
const idle = async (page: Page) => {
  await page.waitForFunction(() => {
    const b = (window as unknown as Hooks).__battle;
    return b ? !b.busy() && b.state().activeFaction === 'attacker' : false;
  }, undefined, { timeout: 180_000 });
};
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(outDir, `siege-${name}.png`) });
  console.log(`  ${name}`);
};
/** Ends the turn and waits for the AI's turn to play out. */
const endTurn = async (page: Page) => {
  await issue(page, { type: 'endTurn' });
  await page.waitForTimeout(300);
  await idle(page);
};

const browser = await launch({ headed: args.includes('--headed') });
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(`${baseUrl()}/battle?e2e&seed=${encodeURIComponent(seed)}`);
  await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && Boolean((window as unknown as Hooks).__battle && (window as unknown as Hooks).__battleCamera), undefined, { timeout: 180_000 });
  await page.evaluate(() => (window as unknown as Hooks).__battleCamera?.setView('gate'));
  await page.waitForTimeout(2500);
  await shot(page, '00-gate-raised');
  // The siege park: the engines, close up.
  const park = await page.evaluate(() => (window as unknown as Hooks).__battle?.state().units.filter((u) => u.id.startsWith('att-siege')).map((u) => (u as unknown as { position: { x: number; z: number } }).position) ?? []);
  if (park.length > 0) {
    const focus = { x: park.reduce((a, p) => a + p.x, 0) / park.length, z: park.reduce((a, p) => a + p.z, 0) / park.length };
    await page.evaluate((f) => (window as unknown as Hooks).__battleCamera?.look({ focus: f, distance: 16, yawTurns: 0.62, pitchDeg: 24 }), focus);
    await page.waitForTimeout(2000);
    await shot(page, '00-park');
    await issue(page, { type: 'attack', unitId: CATAPULT, targetId: OPERATOR });
    await page.waitForTimeout(250);
    await shot(page, '00-park-firing');
    await idle(page);
    await endTurn(page);
    await page.evaluate(() => (window as unknown as Hooks).__battleCamera?.setView('gate'));
    await page.waitForTimeout(1500);
  }

  // 1. The winch operator: the drawbridge drops when they fall.
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const s = await state(page);
    const operator = s.units.find((u) => u.id === OPERATOR);
    if (!operator?.alive) break;
    const rejection = await issue(page, { type: 'attack', unitId: CATAPULT, targetId: OPERATOR });
    console.log(`turn ${s.turn}: catapult → operator (${rejection ?? 'ok'})`);
    const killed = !(await state(page)).units.find((u) => u.id === OPERATOR)?.alive;
    if (killed) {
      // The bridge falls a moment after the blow (attack clip, death, then the drop).
      for (const [ms, name] of [
        [1800, '01-bridge-falling-a'],
        [700, '02-bridge-falling-b'],
        [2500, '03-bridge-down'],
      ] as const) {
        await page.waitForTimeout(ms);
        await shot(page, name);
      }
      await idle(page);
      await endTurn(page);
      break;
    }
    await idle(page);
    await endTurn(page);
  }

  // 2. A curtain segment within catapult range, pounded until it collapses.
  const walls = (await state(page)).structures.filter((x) => x.id.startsWith('wall:') && !x.broken).map((x) => x.id);
  let target: string | null = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const s = await state(page);
    if (target && s.structures.find((x) => x.id === target)?.broken) break;
    let rejection: string | null = 'none';
    for (const id of target ? [target] : walls) {
      rejection = await issue(page, { type: 'attackStructure', unitId: CATAPULT, structureId: id });
      if (rejection === null) {
        target = id;
        break;
      }
    }
    console.log(`turn ${s.turn}: catapult → ${target ?? '-'} (${rejection ?? 'ok'})`);
    if (target && round === 0) {
      await page.evaluate(() => (window as unknown as Hooks).__battleCamera?.setView('gate'));
    }
    const after = (await state(page)).structures.find((x) => x.id === target);
    if (after?.broken) {
      for (const [ms, name] of [
        [900, '04-collapse-a'],
        [500, '05-collapse-b'],
        [700, '06-collapse-c'],
        [3500, '07-breach'],
      ] as const) {
        await page.waitForTimeout(ms);
        await shot(page, name);
      }
      break;
    }
    await page.waitForTimeout(1500);
    if (after && after.hp < 120) await shot(page, `cracks-${after.hp}`);
    await idle(page);
    await endTurn(page);
  }
  console.log(`errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
} finally {
  await browser.close();
}
