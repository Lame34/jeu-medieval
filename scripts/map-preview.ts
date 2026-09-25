/**
 * Generates a battle map and writes a shaded layer preview PNG + the validation report.
 * Usage: node scripts/map-preview.ts [seed] [castleIndex 1-4]
 */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { TerrainLayer } from '../src/core/rules/types.ts';
import { cellCenterHeight } from '../src/core/terrain-data/terrain-data.ts';
import { generateBattleMap } from '../src/core/worldgen/battle.ts';
import { validateBattleMap } from '../src/core/worldgen/validate-map.ts';
import { DEFAULT_RULES } from '../src/data/index.ts';

const seed = process.argv[2] ?? 'siege-1';
const castleIndex = Number(process.argv[3] ?? '1') as 1 | 2 | 3 | 4;

const COLORS: Record<number, [number, number, number]> = {
  [TerrainLayer.Plain]: [134, 163, 78],
  [TerrainLayer.Road]: [188, 158, 112],
  [TerrainLayer.Field]: [220, 182, 92],
  [TerrainLayer.Forest]: [62, 90, 42],
  [TerrainLayer.Mud]: [110, 88, 66],
  [TerrainLayer.Ford]: [120, 170, 160],
  [TerrainLayer.River]: [47, 89, 99],
  [TerrainLayer.Moat]: [38, 51, 43],
  [TerrainLayer.Rock]: [160, 151, 138],
  [TerrainLayer.Building]: [165, 87, 60],
  [TerrainLayer.Wall]: [90, 88, 84],
  [TerrainLayer.Bridge]: [122, 82, 52],
  [TerrainLayer.Rubble]: [140, 130, 120],
  [TerrainLayer.Hedge]: [70, 110, 50],
  [TerrainLayer.DryStoneWall]: [150, 145, 135],
};

const t0 = performance.now();
const { layout, castle, forestCoverage } = generateBattleMap({ seed, castleIndex });
const genMs = performance.now() - t0;
const t1 = performance.now();
const report = validateBattleMap(layout, castle, DEFAULT_RULES, forestCoverage);
const valMs = performance.now() - t1;
const t = layout.terrain;
const px = new Uint8Array(t.width * t.depth * 3);
for (let cz = 0; cz < t.depth; cz++) {
  for (let cx = 0; cx < t.width; cx++) {
    const i = cz * t.width + cx;
    const c = COLORS[t.layers[i] as number] ?? [255, 0, 255];
    const dh = cellCenterHeight(t, Math.min(cx + 1, t.width - 1), cz) - cellCenterHeight(t, Math.max(cx - 1, 0), cz);
    const shade = Math.max(0.55, Math.min(1.35, 1 - dh * 0.35));
    px.set(c.map((v) => Math.min(255, Math.round(v * shade))) as [number, number, number], i * 3);
  }
}
mkdirSync('perf-results', { recursive: true });
const out = `perf-results/map-${seed}-c${castleIndex}.png`;
await sharp(px, { raw: { width: t.width, height: t.depth, channels: 3 } }).png().toFile(out);
console.log(`generated in ${genMs.toFixed(0)} ms, validated in ${valMs.toFixed(0)} ms → ${out}`);
console.log(`houses ${layout.houses.length}, fields ${layout.fields.length}, hedges ${layout.hedges.length}, trees ${layout.trees.length}, towers ${layout.towers.length}`);
console.log(`forest ${(forestCoverage * 100).toFixed(1)} %, viable: ${report.viable.join(', ')}, ok=${report.ok}`);
if (report.problems.length > 0) console.log(`problems: ${report.problems.join(' | ')}`);
