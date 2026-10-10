/**
 * Renders the title screen's illustration with the game itself: a campaign castle at the golden
 * hour, its garrison on the walls and the army in the village, the HUD hidden, framed so the
 * castle stands right of the menu. Encoded as WebP in public/assets/ui/.
 * Usage: node scripts/capture-title.ts [--seed orle-haute] [--castle 3] [--hour 16.4] [--distance 165] [--pitch 13]
 *        [--turn 0.09] [--shift 0.17] [--out public/assets/ui/title.webp]
 *        (dev server on :5188, or SIEGE_URL). Long tower shadows over the hill, the army's siege tower and
 *        the village in the lower left corner, under the menu.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { generateBattleMap } from '../src/core/worldgen/battle.ts';
import type { CastleIndex } from '../src/core/campaign/types.ts';
import { baseUrl, launch } from './browser.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};
const SEED = arg('seed', 'orle-haute');
const CASTLE = Number(arg('castle', '3')) as CastleIndex;
const HOUR = Number(arg('hour', '16.4'));
const OUT = arg('out', 'public/assets/ui/title.webp');
/** Rendered larger than 1080p so the picture stays sharp on wide screens (then scaled down). */
const RENDER = { width: 2560, height: 1440 } as const;
const OUTPUT_WIDTH = 2400;
const WEBP_QUALITY = 82;
/** The camera: far and low, the castle a third from the right edge (the menu takes the left). */
const DISTANCE_M = Number(arg('distance', '165'));
const PITCH_DEG = Number(arg('pitch', '13'));
/** Sideways shift of the focus, as a share of the picture's width at the castle. */
const SHIFT_SHARE = Number(arg('shift', '0.17'));
/** Extra turn of the camera round the castle (turns), to see a corner rather than a face. */
const TURN = Number(arg('turn', '0.09'));
const FOV_DEG = 38;
/** The camera hook the battle installs with ?e2e (src/ui/screens/BattleScreen.tsx). */
interface Hooks {
  __battleCamera?: { look(v: { focus: { x: number; z: number }; distance: number; yawTurns: number; pitchDeg: number }): void };
}
/** Shadows, grass and fires settle after the camera lands. */
const SETTLE_MS = 2500;

const { layout } = generateBattleMap({ seed: SEED, castleIndex: CASTLE });
const keep = layout.keeps[0]?.center ?? layout.focus;
const army = layout.focus;
const yaw = Math.atan2(-(keep.x - army.x), -(keep.z - army.z)) / (2 * Math.PI) + TURN;
const a = yaw * 2 * Math.PI;
const right = { x: Math.cos(a), z: -Math.sin(a) };
const width = 2 * DISTANCE_M * Math.tan(((FOV_DEG / 2) * Math.PI) / 180) * (RENDER.width / RENDER.height);
const focus = { x: keep.x - right.x * width * SHIFT_SHARE, z: keep.z - right.z * width * SHIFT_SHARE };

const browser = await launch();
const page = await browser.newPage({ viewport: RENDER, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${baseUrl()}/battle?e2e&nosound&seed=${SEED}&castle=${CASTLE}&weather=clear&hour=${HOUR}`);
await page.waitForFunction(() => document.body.dataset['sceneReady'] === 'true' && typeof (window as unknown as Hooks).__battleCamera !== 'undefined', undefined, { timeout: 180_000 });
await page.addStyleTag({ content: '.battle-hud, .hud-minimap, .scene-back, .battle-floats { display: none !important; }' });
await page.evaluate((view) => (window as unknown as Hooks).__battleCamera?.look(view), { focus, distance: DISTANCE_M, yawTurns: yaw, pitchDeg: PITCH_DEG });
await page.waitForTimeout(SETTLE_MS);
const png = await page.screenshot({ type: 'png' });
await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
const info = await sharp(png).resize({ width: OUTPUT_WIDTH }).webp({ quality: WEBP_QUALITY }).toFile(OUT);
console.log(`${OUT}: ${info.width}×${info.height}, ${(info.size / 1024).toFixed(0)} KB${errors.length > 0 ? `\nerrors:\n${errors.join('\n')}` : ''}`);
