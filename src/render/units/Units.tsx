/**
 * Units on the battlefield: Quaternius RPG bodies (ADR-014: shared 44-bone rig, one animation
 * library, body and weapon in one skinned mesh with one atlas), so one draw call per unit.
 * Allegiance colours are painted into a recoloured copy of each body's atlas, one per faction;
 * every unit uses a painted material with rim light and stands on a faction ground ring.
 * Siege engines (J4) are rigid vertex-coloured models animated in code (engines.ts), behind the
 * same handle.
 */
import { useGLTF } from '@react-three/drei';
import { HERO_TAG } from '../../core/battle/tags.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AnimationMixer, Color, GreaterDepth, Group, LoopOnce, LoopRepeat, MeshBasicMaterial, SkinnedMesh, Sphere, Vector3, type AnimationAction, type AnimationClip, type Material, type Object3D, type Texture } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Faction } from '../../core/rules/types.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import type { UnitMarker } from '../../core/worldgen/types.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { alignRingToGround, createRingBatch, createRingMarker, RING_MAX_SCALE, RING_SCALE_DISTANCE_M, updateRingBatch } from './FactionRing.ts';
import { createPennants } from './Pennants.ts';
import { PALETTE } from '../materials/palette.ts';
import { createEngineRig, ENGINE_HEIGHT_M, ENGINE_MODELS, engineKindOf, type EngineKind, type EngineRig } from './engines.ts';
import { BODY_CLOTH_HUES, recolorTexture } from './team-colors.ts';

const ANIMATIONS_URL = '/assets/characters/rpg-animations.glb';
const ENGINE_KINDS = Object.keys(ENGINE_MODELS) as EngineKind[];
/** Engines stand on a wider allegiance ring than a soldier. */
/** Allegiance ring under each engine, scaled to show around its chassis (review J4). */
const ENGINE_RING_SCALE: Readonly<Record<EngineKind, number>> = { ram: 3.8, catapult: 3.2, siegeTower: 3.4 };
/** Tests (`?fast`) play the battle animations this much faster (same switch as BattleDirector). */
const TIME_SCALE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fast') ? 8 : 1;
const BODIES = ['warrior', 'ranger', 'rogue'] as const;
type Body = (typeof BODIES)[number];
const bodyUrl = (body: Body) => `/assets/characters/${body}.glb`;

/**
 * Converted bodies stand ~2.9 units tall. Units are shown ~2.4 m: heroic (brief §5.1) and
 * readable at tactical zoom (review v15 asked ×1.2 of 2.15 m; ×1.12 keeps merlons at the hip).
 */
export const UNIT_SCALE = 0.83;
const UNIT_HEIGHT_M = 2.4;
/**
 * Culling bounds of a body (metres, around its feet): wide enough for every gesture, so units
 * off screen are skipped (J5 perf: every body and its shadow were drawn wherever they stood).
 */
const BODY_BOUNDS_M = { centreY: 1.1, radius: 2.2 } as const;
/** Units cast no shadow seen from farther than this (a few pixels; one draw call each). */
const UNIT_SHADOW_MAX_DISTANCE_M = 90;
/**
 * Animation level of detail (camera distance, m): mixers update every frame closer than the
 * first bound, every 2nd frame up to the second, every 4th beyond (with the elapsed time
 * accumulated, staggered across units). Evaluating 44 bones per unit every frame was the main
 * per-frame allocation of the battle map (J3 profiling).
 */
const ANIM_LOD_M: readonly [number, number] = [35, 80];
const ANIM_LOD_STRIDE: readonly [number, number, number] = [1, 2, 4];
const RIM = { color: '#fff1d6', strength: 0.55 };
/** Engines: their broad grazing timber turned grey-blue under the full rim (review J4). */
const ENGINE_RIM = { color: '#fff1d6', strength: 0.18 };
/** Quaternius atlases are painted dark for Blender's studio light; the warrior's steel most. */
const ALBEDO_VALUE: Readonly<Record<Body, number>> = { warrior: 1.7, ranger: 1.3, rogue: 1.35 };

interface Loadout {
  readonly body: Body;
  readonly idle: string;
}

export type UnitClip = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'death';

/** Clip names per body (Quaternius RPG library, see scripts/process-assets.ts). */
const CLIPS: Readonly<Record<Body, Readonly<Record<Exclude<UnitClip, 'idle'>, string>>>> = {
  warrior: { walk: 'Walk', run: 'Run_Weapon', attack: 'Sword_Attack', hit: 'RecieveHit', death: 'Death' },
  ranger: { walk: 'Walk', run: 'Run', attack: 'Bow_Attack_Shoot', hit: 'RecieveHit', death: 'Death' },
  rogue: { walk: 'Walk', run: 'Run_Weapon', attack: 'Dagger_Attack', hit: 'RecieveHit', death: 'Death' },
};
/** Crossfade between clips (s). */
const CLIP_FADE_S = 0.2;
/**
 * Occluded-unit silhouette (brief §8, dynamic transparency): drawn only where the body is hidden
 * (depth test inverted), in the side's colour, for the selected unit and the targeted enemy.
 */
const SILHOUETTE_OPACITY = 0.55;
const SILHOUETTE_ORDER = 5;

/** Drives one unit on screen (battle animation queue). */
export interface UnitHandle {
  readonly id: string;
  readonly root: Group;
  /** Crossfades to `clip`; a clip played once holds its last frame. Returns its duration (s). */
  play(clip: UnitClip, once?: boolean): number;
  /** A dead unit loses its allegiance ring and pennant. */
  setAlive(alive: boolean): void;
  /** Shows the unit through what hides it (selected unit, targeted enemy). */
  setSilhouette(on: boolean): void;
  /** Hides the unit, ring and pennant (an enemy the player's men cannot see in the fog). */
  setHidden(hidden: boolean): void;
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
  heroArcher: { body: 'ranger', idle: 'Idle' },
  heroEngineer: { body: 'rogue', idle: 'Idle' },
  heroKnight: { body: 'warrior', idle: 'Idle' },
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

export function Units({
  units,
  terrain,
  onHandles,
}: {
  readonly units: readonly UnitMarker[];
  readonly terrain: TerrainData;
  /** Receives the unit handles once built (null on teardown). */
  readonly onHandles?: (handles: ReadonlyMap<string, UnitHandle> | null) => void;
}) {
  const anims = useGLTF(ANIMATIONS_URL, false, true);
  const bodies = useGLTF(BODIES.map(bodyUrl), false, true);
  const engineModels = useGLTF(ENGINE_KINDS.map((k) => ENGINE_MODELS[k]), false, true);

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
    const silhouetteMaterials = new Map<Faction, MeshBasicMaterial>();
    const silhouetteMaterialFor = (faction: Faction): MeshBasicMaterial => {
      let m = silhouetteMaterials.get(faction);
      if (!m) {
        m = new MeshBasicMaterial({ color: new Color(PALETTE[faction].primary), transparent: true, opacity: SILHOUETTE_OPACITY, depthFunc: GreaterDepth, depthWrite: false, fog: false });
        m.name = `UnitSilhouette:${faction}`;
        silhouetteMaterials.set(faction, m);
        materials.set(`silhouette:${faction}`, m);
      }
      return m;
    };
    // One material per engine kind (its own height gradient), one program for the three.
    const engineMaterials = Object.fromEntries(
      ENGINE_KINDS.map((kind) => {
        const m = createPaintedMaterial({
          name: `Unit:engine:${kind}`,
          vertexColors: true,
          heightM: ENGINE_HEIGHT_M[kind],
          gradientBase: 0.82,
          gradientSaturation: 0.08,
          valueNoiseAmp: 0.04,
          groundAO: 0.2,
          groundAOHeightM: 0.5,
          rim: ENGINE_RIM,
        });
        materials.set(`engine:${kind}`, m);
        return [kind, m];
      }),
    ) as Record<EngineKind, ReturnType<typeof createPaintedMaterial>>;
    const engines: EngineRig[] = [];
    /** Pennant anchors: a unit's root position, or a point lifted to an engine's top. */
    const anchors: Vector3[] = [];
    const lifted: { anchor: Vector3; root: Group; lift: number }[] = [];
    const animated: { mixer: AnimationMixer; root: Group }[] = [];
    const mixers: AnimationMixer[] = [];
    const starts: (() => void)[] = [];
    const roots: Group[] = [];
    const rings: Object3D[] = [];
    const handles = new Map<string, UnitHandle>();
    const factionOf: UnitMarker['faction'][] = [];
    const alive: boolean[] = [];
    const hidden: boolean[] = [];
    const shadowCasters: Object3D[] = [];
    units.forEach((unit, index) => {
      const engineKind = engineKindOf(unit.typeKey);
      if (engineKind) {
        const model = engineModels[ENGINE_KINDS.indexOf(engineKind)]?.scene;
        if (!model) return;
        const rig = createEngineRig(model, engineKind, engineMaterials[engineKind], silhouetteMaterialFor(unit.faction), SILHOUETTE_ORDER);
        const root = new Group();
        root.name = `Unit:${unit.id}`;
        const ring = createRingMarker();
        ring.userData['engine'] = ENGINE_RING_SCALE[engineKind];
        rings.push(ring);
        root.add(rig.pose, ring);
        root.position.set(unit.position.x, unit.elevationM ?? sampleHeight(terrain, unit.position.x, unit.position.z), unit.position.z);
        root.rotation.y = unit.facingTurns * 2 * Math.PI;
        const slot = roots.length;
        factionOf.push(unit.faction);
        alive.push(true);
        hidden.push(false);
        engines.push(rig);
        const anchor = new Vector3();
        anchors.push(anchor);
        lifted.push({ anchor, root, lift: ENGINE_HEIGHT_M[engineKind] - UNIT_HEIGHT_M });
        handles.set(unit.id, {
          id: unit.id,
          root,
          play: (clip, once = false) => rig.play(clip, once),
          setAlive(on) {
            alive[slot] = on;
            ring.visible = on;
          },
          setSilhouette: (on) => rig.setSilhouette(on),
          setHidden(h) {
            hidden[slot] = h;
            root.visible = !h;
          },
        });
        roots.push(root);
        return;
      }
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
        // Fixed bounds in the mesh's frame (the rest pose's do not follow the animation).
        o.boundingSphere = new Sphere(new Vector3(0, BODY_BOUNDS_M.centreY / UNIT_SCALE, 0), BODY_BOUNDS_M.radius / UNIT_SCALE);
        shadowCasters.push(o);
      });
      body.scale.setScalar(UNIT_SCALE);
      const root = new Group();
      root.name = `Unit:${unit.id}`;
      const ring = createRingMarker();
      rings.push(ring);
      root.add(body, ring);
      root.position.set(unit.position.x, unit.elevationM ?? sampleHeight(terrain, unit.position.x, unit.position.z), unit.position.z);
      root.rotation.y = unit.facingTurns * 2 * Math.PI;
      const mixer = new AnimationMixer(body);
      const idle = clips.get(loadout.idle) ?? clips.get('Idle');
      mixers.push(mixer);
      animated.push({ mixer, root });
      anchors.push(root.position);
      const actions = new Map<UnitClip, AnimationAction>();
      const actionFor = (clip: UnitClip): AnimationAction | null => {
        const cached = actions.get(clip);
        if (cached) return cached;
        const source = clip === 'idle' ? idle : clips.get(CLIPS[loadout.body][clip]);
        if (!source) return null;
        const action = mixer.clipAction(source);
        actions.set(clip, action);
        return action;
      };
      let current: AnimationAction | null = null;
      starts.push(() => {
        current = actionFor('idle');
        if (!current || !idle) return;
        current.reset().play();
        current.time = (index * 0.37) % idle.duration;
      });
      const slot = roots.length;
      // Silhouette: the same skinned geometry bound to the same skeleton, created on first use.
      let silhouettes: SkinnedMesh[] | null = null;
      const silhouetteMaterial = silhouetteMaterialFor(unit.faction);
      factionOf.push(unit.faction);
      alive.push(true);
        hidden.push(false);
      handles.set(unit.id, {
        id: unit.id,
        root,
        play(clip, once = false) {
          const next = actionFor(clip);
          if (!next) return 0;
          next.reset();
          next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
          next.clampWhenFinished = once;
          next.enabled = true;
          next.play();
          if (current && current !== next) current.crossFadeTo(next, CLIP_FADE_S, false);
          current = next;
          return next.getClip().duration;
        },
        setAlive(on) {
          alive[slot] = on;
          ring.visible = on;
        },
        setHidden(h) {
          hidden[slot] = h;
          root.visible = !h;
        },
        setSilhouette(on) {
          if (!silhouettes) {
            if (!on) return;
            const owners: SkinnedMesh[] = [];
            body.traverse((o) => {
              if (o instanceof SkinnedMesh) owners.push(o);
            });
            silhouettes = owners.map((o) => {
              const ghost = new SkinnedMesh(o.geometry, silhouetteMaterial);
              ghost.bind(o.skeleton, o.bindMatrix);
              ghost.frustumCulled = false;
              ghost.renderOrder = SILHOUETTE_ORDER;
              o.parent?.add(ghost);
              return ghost;
            });
          }
          for (const ghost of silhouettes) ghost.visible = on;
        },
      });
      roots.push(root);
    });
    // Allegiance pennants above the heads, one instanced batch per side; the heroes carry gold ones.
    const isHero = (i: number) => DEFAULT_RULES.units[units[i]?.typeKey ?? '']?.tags.includes(HERO_TAG) ?? false;
    const pennants = (['attacker', 'defender', 'hero'] as const).map((kind) => {
      const slots = roots.map((_, i) => i).filter((i) => (kind === 'hero' ? isHero(i) : factionOf[i] === kind && !isHero(i)));
      return {
        pennants: createPennants(kind, units.length, UNIT_HEIGHT_M + 0.25),
        anchors: slots.map((i) => anchors[i] as Vector3),
        slots,
        visible: new Uint8Array(slots.length).fill(1),
      };
    });
    // The rings, one instanced batch per side.
    const ringBatches = (['attacker', 'defender'] as const).map((faction) => {
      const markers = rings.filter((_, i) => factionOf[i] === faction);
      return { batch: createRingBatch(faction, markers.length), markers };
    });
    return { roots, rings, ringBatches, shadowCasters, shadowsOn: { value: true }, mixers, animated, engines, lifted, starts, materials, textures, pennants, handles, alive, hidden, animElapsed: new Float32Array(mixers.length) };
  }, [anims, bodies, engineModels, units, terrain]);

  // Actions start and stop with the effect (StrictMode remounts must restart them).
  useEffect(() => {
    built.starts.forEach((start) => start());
    onHandles?.(built.handles);
    return () => {
      onHandles?.(null);
      built.mixers.forEach((m) => m.stopAllAction());
    };
  }, [built, onHandles]);

  const frame = useRef(0);
  const heightAt = useMemo(() => (x: number, z: number) => sampleHeight(terrain, x, z), [terrain]);
  useFrame(({ camera }, delta) => {
    const f = frame.current++;
    for (let i = 0; i < built.animated.length; i++) {
      built.animElapsed[i] = (built.animElapsed[i] as number) + delta;
      const d = camera.position.distanceTo((built.animated[i] as { root: Group }).root.position);
      const stride = d < ANIM_LOD_M[0] ? ANIM_LOD_STRIDE[0] : d < ANIM_LOD_M[1] ? ANIM_LOD_STRIDE[1] : ANIM_LOD_STRIDE[2];
      if ((f + i) % stride !== 0) continue;
      (built.animated[i] as { mixer: AnimationMixer }).mixer.update(built.animElapsed[i] as number);
      built.animElapsed[i] = 0;
    }
    for (const rig of built.engines) rig.update(delta * TIME_SCALE);
    for (const l of built.lifted) l.anchor.copy(l.root.position).setY(l.root.position.y + l.lift);
    const distance = camera.position.distanceTo(paintedGlobals.uFocus.value);
    const scale = Math.min(RING_MAX_SCALE, Math.max(1, distance / RING_SCALE_DISTANCE_M));
    for (const ring of built.rings) ring.scale.setScalar(scale * ((ring.userData['engine'] as number | undefined) ?? 1));
    for (const ring of built.rings) if (ring.parent) alignRingToGround(ring, ring.parent, heightAt);
    for (const { batch, markers } of built.ringBatches) updateRingBatch(batch, markers);
    // Far views: no unit shadows (switched only when the threshold is crossed).
    const shadows = distance < UNIT_SHADOW_MAX_DISTANCE_M;
    if (shadows !== built.shadowsOn.value) {
      built.shadowsOn.value = shadows;
      for (const o of built.shadowCasters) o.castShadow = shadows;
    }
    for (const p of built.pennants) {
      for (let k = 0; k < p.slots.length; k++) p.visible[k] = built.alive[p.slots[k] as number] && !built.hidden[p.slots[k] as number] ? 1 : 0;
      p.pennants.update(p.anchors, camera.position, distance, scale, p.visible);
    }
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
      {built.ringBatches.map(({ batch }) => (
        <primitive key={batch.name} object={batch} />
      ))}
    </>
  );
}

useGLTF.preload(ANIMATIONS_URL, false, true);
for (const k of ENGINE_KINDS) useGLTF.preload(ENGINE_MODELS[k], false, true);
for (const b of BODIES) useGLTF.preload(bodyUrl(b), false, true);
