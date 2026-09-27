/**
 * Curated look-dev captures for the style log (brief §13): the PNG captures of one iteration
 * (docs/captures/<folder>/, git-ignored) → WebP, 1280 px wide, in docs/style-log/<name>/
 * (versioned, small).
 * Usage: node scripts/style-log.ts <captures folder> <name> [width]
 */
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [folder, name, widthArg] = process.argv.slice(2);
if (!folder || !name) throw new Error('usage: node scripts/style-log.ts <captures folder> <name> [width]');
const width = Number(widthArg ?? 1280);
const source = join('docs', 'captures', folder);
const target = join('docs', 'style-log', name);
mkdirSync(target, { recursive: true });
let bytes = 0;
for (const file of readdirSync(source).filter((f) => f.endsWith('.png')).sort()) {
  const out = join(target, file.replace(/\.png$/, '.webp'));
  const info = await sharp(join(source, file)).resize({ width }).webp({ quality: 82 }).toFile(out);
  bytes += info.size;
  console.log(`→ ${out} (${(info.size / 1024).toFixed(0)} KiB)`);
}
console.log(`${(bytes / 1024 / 1024).toFixed(1)} MiB in ${target}`);
