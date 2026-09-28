/**
 * Units on the battlefield: Quaternius RPG bodies (ADR-014: shared 44-bone rig, one animation
 * library, body and weapon in one skinned mesh with one atlas), so one draw call per unit.
 * Allegiance colours are painted into a recoloured copy of each body's atlas, one per faction;
 * every unit uses a painted material with rim light and stands on a faction ground ring.
 */
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AnimationMixer, Group, SkinnedMesh, type AnimationClip, type Material, type Object3D, type Texture } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Faction } from '../../core/rules/types.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { UnitMarker } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { createFactionRing, RING_MAX_SCALE, RING_SCALE_DISTANCE_M } from './FactionRing.ts';
import { createPennants } from './Pennants.ts';
import { BODY_CLOTH_HUES, recolorTexture } from './team-colors.ts';

const ANIMATIONS_URL = '/assets/characters/rpg-animations.glb';
const BODIES = ['warrior', 'ranger', 'rogue'] as const;
type Body = (typeof BODIES)[number];
const bodyUrl = (body: Body) => `/assets/characters/${body}.glb`;

/**
 * Converted bodies stand ~2.9 units tall. Units are shown ~2.4 m: heroic (brief §5.1) and
 * readable at tactical zoom (review v15 asked ×1.2 of 2.15 m; ×1.12 keeps merlons at the hip).
 */
export const UNIT_SCALE = 0.83;
const UNIT_HEIGHT_M = 2.4;
const RIM = { color: '#fff1d6', strength: 0.55 };
/** Quaternius atlases are painted dark for Blender's studio light; the warrior's steel most. */
const ALBEDO_VALUE: Readonly<Record<Body, number>> = { warrior: 1.7, ranger: 1.3, rogue: 1.35 };

interface Loadout {
  readonly body: Body;
  readonly idle: string;
}

const LOADOUTS: Readonly<Record<string, Loadout>> = {
  knight: { body: 'warrior', idle: 'Idle' },
  soldier: { body: 'rogue', idle: 'Idle' },
  archer: { body: 'ranger', idle: 'Idle' },
  sapper: { body: 'rogue', idle: 'Idle' },
  wallGuard: { body: 'warrior', idle: 'Idle' },
  crossbowman: { body: 'ranger', idle: 'Idle' },
  sallyKnight: { body: 'warrior', idle: 'Idle' },
  militia: { body: 'rogue', idle: 'Idle' },
  officer: { body: 'warrior', idle: 'Idle' },
  towerArcher: { body: 'ranger', idle: 'Idle' },
};
const DEFAULT_LOADOUT = LOADOUTS['knight'] as Loadout;

export function loadoutFor(typeKey: string): Loadout {
  return LOADOUTS[typeKey] ?? DEFAULT_LOADOUT;
}

function atlasOf(scene: Object3D): Texture | null {
  let map: Texture | null = null;
  scene.traverse((o) => {
    if (o instanceof SkinnedMesh && !map) map = (o.material as { map?: Texture | null }).map ?? null;
  });
  return map;
}

export function Units({ units, terrain }: { readonly units: readonly UnitMarker[]; readonly terrain: TerrainData }) {
  const anims = useGLTF(ANIMATIONS_URL, false, true);
  const bodies = useGLTF(BODIES.map(bodyUrl), false, true);

  const built = useMemo(() => {
    // One material per (body, faction): same shader program, only the atlas differs.
    const materials = new Map<string, Material>();
    const textures: Texture[] = [];
    const materialFor = (body: Body, faction: Faction): Material => {
      const key = `${body}:${faction}`;
      const cached = materials.get(key);
      if (cached) return cached;
      const source = atlasOf(bodies[BODIES.indexOf(body)]?.scene as Object3D);
      const map = source ? recolorTexture(source, BODY_CLOTH_HUES[body] ?? [], faction) : null;
      if (map) textures.push(map);
      const material = createPaintedMaterial({
        name: `Unit:${key}`,
        map,
        heightM: UNIT_HEIGHT_M,
        gradientBase: 0.82,
        gradientSaturation: 0.08,
        hueNoiseAmp: 0,
        valueNoiseAmp: 0.03,
        albedoValue: ALBEDO_VALUE[body],
        albedoSaturation: 1.05,
        groundAO: 0.2,
        groundAOHeightM: 0.3,
        rim: RIM,
        saturationCeiling: false,
      });
      materials.set(key, material);
      return material;
    };
    const clips = new Map<string, AnimationClip>(anims.animations.map((c) => [c.name, c]));
    const mixers: AnimationMixer[] = [];
    const starts: (() => void)[] = [];
    const roots: Group[] = [];
    const rings: Object3D[] = [];
    units.forEach((unit, index) => {
      const loadout = loadoutFor(unit.typeKey);
      const source = bodies[BODIES.indexOf(loadout.body)]?.scene;
      if (!source) return;
      const body = cloneSkinned(source);
      const material = materialFor(loadout.body, unit.faction);
      body.traverse((o) => {
        if (!(o instanceof SkinnedMesh)) return;
        o.material = material;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      });
      body.scale.setScalar(UNIT_SCALE);
      const root = new Group();
      root.name = `Unit:${unit.id}`;
      const ring = createFactionRing(unit.faction);
      rings.push(ring);
      root.add(body, ring);
      root.position.set(unit.position.x, unit.elevationM ?? sampleHeight(terrain, unit.position.x, unit.position.z), unit.position.z);
      root.rotation.y = unit.facingTurns * 2 * Math.PI;
      const mixer = new AnimationMixer(body);
      const idle = clips.get(loadout.idle) ?? clips.get('Idle');
      mixers.push(mixer);
      starts.push(() => {
        if (!idle) return;
        const action = mixer.clipAction(idle);
        action.reset().play();
        action.time = (index * 0.37) % idle.duration;
      });
      roots.push(root);
    });
    // Allegiance pennants above the heads, one instanced batch per side.
    const pennants = (['attacker', 'defender'] as const).map((faction) => ({
      pennants: createPennants(faction, units.length, UNIT_HEIGHT_M + 0.25),
      anchors: roots.filter((_, i) => units[i]?.faction === faction).map((root) => root.position),
    }));
    return { roots, rings, mixers, starts, materials, textures, pennants };
  }, [anims, bodies, units, terrain]);

  // Actions start and stop with the effect (StrictMode remounts must restart them).
  useEffect(() => {
    built.starts.forEach((start) => start());
    return () => built.mixers.forEach((m) => m.stopAllAction());
  }, [built]);

  useFrame(({ camera }, delta) => {
    for (const mixer of built.mixers) mixer.update(delta);
    const distance = camera.position.distanceTo(paintedGlobals.uFocus.value);
    const scale = Math.min(RING_MAX_SCALE, Math.max(1, distance / RING_SCALE_DISTANCE_M));
    for (const ring of built.rings) ring.scale.setScalar(scale);
    for (const { pennants, anchors } of built.pennants) pennants.update(anchors, camera.position, distance, scale);
  });

  useEffect(
    () => () => {
      built.materials.forEach((m) => m.dispose());
      built.textures.forEach((t) => t.dispose());
      built.pennants.forEach(({ pennants }) => pennants.dispose());
    },
    [built],
  );

  return (
    <>
      {built.roots.map((root) => (
        <primitive key={root.name} object={root} />
      ))}
      {built.pennants.map(({ pennants }) => (
        <primitive key={pennants.mesh.name} object={pennants.mesh} />
      ))}
    </>
  );
}

useGLTF.preload(ANIMATIONS_URL, false, true);
