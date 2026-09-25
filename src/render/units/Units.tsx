/**
 * Units on the battlefield: KayKit bodies (shared 41-bone rig, one animation library) merged
 * with their weapons into one skinned mesh each (one draw call per unit), faction colours baked
 * into vertex colours, one shared painted material with rim light, and a faction ground ring.
 */
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AnimationMixer, Group, PropertyBinding, type AnimationClip } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { UnitMarker } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { createFactionRing } from './FactionRing.ts';
import { mergeCharacter, type WeaponMount } from './merge-character.ts';
import { BODY_CLOTH_HUES } from './team-colors.ts';

const ANIMATIONS_URL = '/assets/characters/kaykit-animations.glb';
const bodyUrl = (body: string) => `/assets/characters/${body}.glb`;
const weaponUrl = (weapon: string) => `/assets/weapons/${weapon}.glb`;

/**
 * KayKit bodies are authored ~2.1 units tall. Units are shown ~35 % above human scale
 * ("proportions légèrement héroïques"): silhouettes must read at tactical zoom.
 */
export const UNIT_SCALE = 1.16;
const UNIT_HEIGHT_M = 2.4;
const RIM = { color: '#fff1d6', strength: 0.35 };
/** GLTFLoader sanitises node names ('handslot.r' → 'handslotr'). */
const RIGHT_HAND = PropertyBinding.sanitizeNodeName('handslot.r');
const LEFT_HAND = PropertyBinding.sanitizeNodeName('handslot.l');

interface Loadout {
  readonly body: string;
  readonly right?: string;
  readonly left?: string;
  readonly idle: string;
}

const LOADOUTS: Readonly<Record<string, Loadout>> = {
  knight: { body: 'knight', right: 'sword_1handed', left: 'shield_badge_color', idle: 'Idle' },
  soldier: { body: 'barbarian', right: 'axe_1handed', left: 'shield_round_color', idle: 'Idle' },
  archer: { body: 'rogue_hooded', right: 'crossbow_1handed', idle: 'Idle' },
  sapper: { body: 'rogue', right: 'axe_1handed', idle: 'Idle' },
  wallGuard: { body: 'barbarian', right: 'axe_1handed', left: 'shield_square_color', idle: 'Idle' },
  crossbowman: { body: 'rogue', right: 'crossbow_2handed', idle: '2H_Ranged_Aiming' },
  sallyKnight: { body: 'knight', right: 'sword_1handed', left: 'shield_square_color', idle: 'Idle' },
  militia: { body: 'rogue', right: 'axe_1handed', idle: 'Idle' },
  officer: { body: 'knight', right: 'sword_1handed', idle: 'Idle' },
  towerArcher: { body: 'rogue_hooded', right: 'crossbow_1handed', idle: 'Idle' },
};
const DEFAULT_LOADOUT = LOADOUTS['knight'] as Loadout;

export function loadoutFor(typeKey: string): Loadout {
  return LOADOUTS[typeKey] ?? DEFAULT_LOADOUT;
}

const BODIES = ['knight', 'barbarian', 'rogue', 'rogue_hooded', 'mage'] as const;
const WEAPONS = ['sword_1handed', 'axe_1handed', 'crossbow_1handed', 'crossbow_2handed', 'shield_badge_color', 'shield_round_color', 'shield_square_color'] as const;

export function Units({ units, terrain }: { readonly units: readonly UnitMarker[]; readonly terrain: TerrainData }) {
  const anims = useGLTF(ANIMATIONS_URL, false, true);
  const bodies = useGLTF(BODIES.map(bodyUrl), false, true);
  const weapons = useGLTF(WEAPONS.map(weaponUrl), false, true);

  const built = useMemo(() => {
    // One material (one program) for every unit: colours live in the vertices.
    const material = createPaintedMaterial({
      name: 'Units',
      vertexColors: true,
      heightM: UNIT_HEIGHT_M,
      gradientBase: 0.82,
      gradientSaturation: 0.05,
      hueNoiseAmp: 0,
      valueNoiseAmp: 0.02,
      groundAO: 0.2,
      groundAOHeightM: 0.3,
      rim: RIM,
    });
    const clips = new Map<string, AnimationClip>(anims.animations.map((c) => [c.name, c]));
    const bodyScene = (name: string) => bodies[BODIES.indexOf(name as (typeof BODIES)[number])]?.scene;
    const weaponScene = (name: string) => weapons[WEAPONS.indexOf(name as (typeof WEAPONS)[number])]?.scene;
    const mixers: AnimationMixer[] = [];
    const starts: (() => void)[] = [];
    const roots: Group[] = [];
    units.forEach((unit, index) => {
      const loadout = loadoutFor(unit.typeKey);
      const source = bodyScene(loadout.body);
      if (!source) return;
      const body = cloneSkinned(source);
      const mounts: WeaponMount[] = [];
      for (const [bone, weapon] of [
        [RIGHT_HAND, loadout.right],
        [LEFT_HAND, loadout.left],
      ] as const) {
        const scene = weapon ? weaponScene(weapon) : undefined;
        if (scene) mounts.push({ bone, scene, clothHues: BODY_CLOTH_HUES['shield'] ?? [] });
      }
      const mesh = mergeCharacter(body, mounts, BODY_CLOTH_HUES[loadout.body] ?? [], unit.faction);
      mesh.material = material;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const root = new Group();
      root.name = `Unit:${unit.id}`;
      body.scale.setScalar(UNIT_SCALE);
      root.add(body, createFactionRing(unit.faction));
      root.position.set(unit.position.x, sampleHeight(terrain, unit.position.x, unit.position.z), unit.position.z);
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
    return { roots, mixers, starts, material };
  }, [anims, bodies, weapons, units, terrain]);

  // Actions start and stop with the effect (StrictMode remounts must restart them).
  useEffect(() => {
    built.starts.forEach((start) => start());
    return () => built.mixers.forEach((m) => m.stopAllAction());
  }, [built]);

  useFrame((_, delta) => {
    for (const mixer of built.mixers) mixer.update(delta);
  });

  useEffect(
    () => () => {
      built.roots.forEach((root) =>
        root.traverse((o) => {
          if ('geometry' in o && o.name === 'UnitBody') (o as { geometry: { dispose(): void } }).geometry.dispose();
        }),
      );
      built.material.dispose();
    },
    [built],
  );

  return (
    <>
      {built.roots.map((root) => (
        <primitive key={root.name} object={root} />
      ))}
    </>
  );
}

useGLTF.preload(ANIMATIONS_URL, false, true);
