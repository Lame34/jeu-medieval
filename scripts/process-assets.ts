/**
 * Asset pipeline (brief §6.3): raw CC0 downloads in assets-src/raw → optimised GLB in
 * public/assets, plus a typed manifest (src/render/assets/asset-manifest.json).
 * Steps per asset: keep only the animation clips the game uses, dedup, prune, weld, resize
 * textures, meshopt compression.
 * Usage: node scripts/process-assets.ts [--only <id>]
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Document, NodeIO, type Scene } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, meshopt, mergeDocuments, prune, resample, simplify, textureCompress, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const KAYKIT = 'assets-src/raw/kaykit-adventurers/KayKit-Character-Pack-Adventures-1.0-main/addons/kaykit_character_pack_adventures';
const OUT_ROOT = 'public/assets';
const MANIFEST = 'src/render/assets/asset-manifest.json';

/**
 * Quaternius RPG Characters, converted by scripts/blender/convert_rpg_characters.py
 * (npm run assets:characters): retuned proportions, body+weapon atlas, shared clip library.
 */
const RPG = 'assets-src/work/rpg';
const RPG_BODIES = ['warrior', 'ranger', 'rogue'] as const;

/** Animation clips the game plays (brief §6.5); everything else is stripped. */
const CHARACTER_CLIPS = [
  'Idle',
  'Idle_Weapon',
  'Idle_Attacking',
  'Walk',
  'Run',
  'Run_Weapon',
  'Run_Holding',
  'Sword_Attack',
  'Sword_AttackFast',
  'Dagger_Attack',
  'Bow_Attack_Draw',
  'Bow_Attack_Shoot',
  'Punch',
  'RecieveHit',
  'Death',
  'Roll',
  'PickUp',
] as const;

interface AssetJob {
  readonly id: string;
  readonly kind: 'character' | 'weapon' | 'animations' | 'engine';
  readonly source: string;
  readonly out: string;
  readonly textureSize: number;
  /** Clips to keep; an empty list strips every animation. */
  readonly keepClips?: readonly string[];
  /** Animation-only library: meshes and textures are removed, the skeleton stays. */
  readonly animationsOnly?: boolean;
}

const JOBS: readonly AssetJob[] = [
  // Every RPG body shares one 44-bone rig: one animation library for all of them.
  {
    id: 'animations.rpg',
    kind: 'animations',
    source: `${RPG}/rpg-animations.glb`,
    out: 'characters/rpg-animations.glb',
    textureSize: 0,
    keepClips: CHARACTER_CLIPS,
    animationsOnly: true,
  },
  ...RPG_BODIES.map((name) => ({
    id: `character.${name}`,
    kind: 'character' as const,
    source: `${RPG}/${name}.glb`,
    out: `characters/${name}.glb`,
    // 1536×1024 body+weapon atlas → 768×512.
    textureSize: 768,
    keepClips: [],
  })),
  // KayKit props (CC0): shields and crossbows kept for the J3 loadouts.
  ...['sword_1handed', 'axe_1handed', 'crossbow_2handed', 'crossbow_1handed', 'shield_round_color', 'shield_square_color', 'shield_badge_color', 'quiver', 'arrow_bundle'].map((name) => ({
    id: `weapon.${name}`,
    kind: 'weapon' as const,
    source: `${KAYKIT}/Assets/gltf/${name}.gltf`,
    out: `weapons/${name}.glb`,
    textureSize: 256,
  })),
  // Siege engines built by scripts/blender/build_siege_engines.py (npm run assets:engines):
  // vertex-coloured, no texture.
  ...['ram', 'catapult', 'siegeTower'].map((name) => ({
    id: `engine.${name}`,
    kind: 'engine' as const,
    source: `assets-src/work/engines/${name}.glb`,
    out: `engines/${name}.glb`,
    textureSize: 0,
    keepClips: [],
  })),
];

/** Modular village pieces packed into one GLB (one mesh per piece, shared trim textures). */
const VILLAGE_DIR = 'assets-src/raw/medieval-village-megakit/glTF';
const VILLAGE_PIECES = [
  'Wall_Plaster_Straight',
  'Wall_Plaster_WoodGrid',
  'Wall_Plaster_Window_Wide_Round',
  'Wall_Plaster_Window_Thin_Round',
  'Wall_Plaster_Door_Round',
  'Wall_UnevenBrick_Straight',
  'Wall_UnevenBrick_Window_Wide_Round',
  'Wall_UnevenBrick_Door_Round',
  'Corner_Exterior_Wood',
  'Corner_Exterior_Brick',
  'Door_1_Round',
  'WindowShutters_Wide_Round_Open',
  'WindowShutters_Thin_Round_Closed',
  'Roof_RoundTiles_4x4',
  'Roof_RoundTiles_4x6',
  'Roof_RoundTiles_4x8',
  'Roof_RoundTiles_6x6',
  'Roof_RoundTiles_6x8',
  'Roof_Front_Brick4',
  'Roof_Front_Brick6',
  'Prop_Chimney',
  'Prop_Chimney2',
  'Prop_Crate',
  'Prop_Wagon',
  'Prop_WoodenFence_Single',
  'Prop_WoodenFence_Extension1',
] as const;
const KIT_TEXTURE_SIZE = 1024;
/** Kit pieces simplified within this error (share of each piece's size), seams kept: every wall is repeated. */
const KIT_SIMPLIFY_ERROR = 0.003;

async function buildVillageKit(io: NodeIO): Promise<ManifestEntry> {
  const kit = new Document();
  kit.createBuffer();
  const scene = kit.createScene('Kit');
  for (const piece of VILLAGE_PIECES) {
    const src = await io.read(join(VILLAGE_DIR, `${piece}.gltf`));
    const map = mergeDocuments(kit, src);
    for (const srcScene of src.getRoot().listScenes()) {
      const merged = map.get(srcScene) as Scene;
      const holder = kit.createNode(piece);
      for (const child of merged.listChildren()) holder.addChild(child);
      scene.addChild(holder);
      merged.dispose();
    }
  }
  // Albedo only (ADR-010): normal, roughness and ORM maps are dropped.
  for (const material of kit.getRoot().listMaterials()) {
    material.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    material.setMetallicFactor(0).setRoughnessFactor(1);
  }
  await kit.transform(
    unpartition(),
    dedup(),
    prune(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: KIT_SIMPLIFY_ERROR, lockBorder: true }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [KIT_TEXTURE_SIZE, KIT_TEXTURE_SIZE] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  kit.createExtension(EXTMeshoptCompression).setRequired(true);
  const out = join(OUT_ROOT, 'kits/village-kit.glb');
  mkdirSync(dirname(out), { recursive: true });
  await io.write(out, kit);
  const bytes = statSync(out).size;
  console.log(`${'kit.village'.padEnd(34)} ${(bytes / 1024).toFixed(0).padStart(6)} KiB  pieces=${VILLAGE_PIECES.length}`);
  return { id: 'kit.village', kind: 'kit', url: '/assets/kits/village-kit.glb', bytes, clips: [] };
}

interface ManifestEntry {
  readonly id: string;
  readonly kind: AssetJob['kind'] | 'kit';
  readonly url: string;
  readonly bytes: number;
  readonly clips: string[];
}

function stripClips(doc: Document, keep: readonly string[] | undefined): string[] {
  const kept: string[] = [];
  for (const anim of doc.getRoot().listAnimations()) {
    if (keep && !keep.includes(anim.getName())) {
      // Samplers hold the keyframe accessors: dispose them explicitly or prune() keeps the data.
      // (Accessors themselves may be shared with kept clips; prune() removes the orphans.)
      for (const channel of anim.listChannels()) channel.dispose();
      for (const sampler of anim.listSamplers()) sampler.dispose();
      anim.dispose();
    } else kept.push(anim.getName());
  }
  return kept;
}

async function main(): Promise<void> {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const manifest: ManifestEntry[] = [];
  for (const job of JOBS) {
    if (only && job.id !== only) continue;
    const doc = await io.read(job.source);
    const clips = stripClips(doc, job.keepClips);
    if (job.animationsOnly) {
      for (const node of doc.getRoot().listNodes()) node.setMesh(null);
      for (const mesh of doc.getRoot().listMeshes()) mesh.dispose();
    }
    await doc.transform(
      dedup(),
      resample(),
      prune({ keepLeaves: Boolean(job.animationsOnly) }),
      weld(),
      ...(job.textureSize > 0 ? [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [job.textureSize, job.textureSize] })] : []),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true);
    const out = join(OUT_ROOT, job.out);
    mkdirSync(dirname(out), { recursive: true });
    await io.write(out, doc);
    const bytes = statSync(out).size;
    manifest.push({ id: job.id, kind: job.kind, url: `/assets/${job.out}`, bytes, clips });
    console.log(`${job.id.padEnd(34)} ${(bytes / 1024).toFixed(0).padStart(6)} KiB  clips=${clips.length}`);
  }
  if (!only || only === 'kit.village') manifest.push(await buildVillageKit(io));
  if (!only) {
    mkdirSync(dirname(MANIFEST), { recursive: true });
    writeFileSync(MANIFEST, `${JSON.stringify({ generated: 'scripts/process-assets.ts', assets: manifest }, null, 2)}\n`);
    console.log(`manifest → ${MANIFEST}`);
  }
}

await main();
