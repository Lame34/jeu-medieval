/**
 * Prints the local bounding box of every glTF in a folder (after node transforms), to design
 * modular assembly recipes. Usage: node scripts/inspect-bounds.ts <folder> [nameFilterRegex]
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const [folder, filter] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node scripts/inspect-bounds.ts <folder> [regex]');
  process.exit(1);
}
const pattern = filter ? new RegExp(filter, 'i') : null;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = readdirSync(folder).filter((f) => /\.(gltf|glb)$/i.test(f) && (!pattern || pattern.test(f)));
const fmt = (v: number) => v.toFixed(2).padStart(6);
for (const file of files.sort()) {
  const doc = await io.read(join(folder, file));
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) continue;
  const { min, max } = getBounds(scene);
  console.log(
    `${file.replace(/\.(gltf|glb)$/i, '').padEnd(38)} x[${fmt(min[0])},${fmt(max[0])}] y[${fmt(min[1])},${fmt(max[1])}] z[${fmt(min[2])},${fmt(max[2])}]`,
  );
}
