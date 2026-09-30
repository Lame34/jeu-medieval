/**
 * Everything a generated world needs on screen, in one place: atmosphere, sky, terrain and its
 * decorative ring, water, vegetation, fields, houses, castle, units and the post chain.
 */
import { useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo } from 'react';
import { Vector2 } from 'three';
import type { UnitMarker, WorldLayout } from '../core/worldgen/types.ts';
import { Atmosphere } from './atmosphere/Atmosphere.tsx';
import { Buildings } from './buildings/Buildings.tsx';
import { Castle } from './castle/Castle.tsx';
import { Hedges } from './fields/Hedges.tsx';
import { Fields } from './fields/WheatField.tsx';
import { PostFX } from './postfx/PostFX.tsx';
import { Props } from './props/Props.tsx';
import { Sky } from './sky/Sky.tsx';
import { ChunkedTerrain } from './terrain/ChunkedTerrain.tsx';
import { DistantLandscape } from './terrain/DistantLandscape.tsx';
import { Terrain } from './terrain/Terrain.tsx';
import { useSettings } from '../state/settings.ts';
import { paintedGlobals } from './materials/painted-globals.ts';
import { assignShadowDepthMaterials } from './materials/shadow-depth.ts';
import { QUALITY_PRESETS } from './quality/presets.ts';
import { buildHeightTexture, buildSplatTexture } from './terrain/terrain-textures.ts';
import { Units, type UnitHandle } from './units/Units.tsx';
import { Grass } from './vegetation/Grass.tsx';
import { Vegetation } from './vegetation/Vegetation.tsx';
import { Water } from './water/Water.tsx';

/** Look-dev-sized terrains stay one mesh; battle maps (512 m) use chunked LOD terrain. */
const SINGLE_MESH_TERRAIN_CELLS = 256;

/** Signals (bench/capture scripts) that suspended assets are in and shaders are compiled. */
function SceneReady() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let cancelled = false;
    // One shadow depth material per kind of caster (no program switch in the shadow pass).
    assignShadowDepthMaterials(scene);
    // Compile every program up front (brief §7: no in-game shader hitch).
    void gl.compileAsync(scene, camera).then(() => {
      if (cancelled) return;
      const perf = window.__perf;
      if (perf) perf.control['sceneReady'] = () => true;
      document.body.dataset['sceneReady'] = 'true';
    });
    return () => {
      cancelled = true;
      delete document.body.dataset['sceneReady'];
    };
  }, [gl, scene, camera]);
  return null;
}

export function WorldScene({
  layout,
  postfx = true,
  units,
  onUnitHandles,
}: {
  readonly layout: WorldLayout;
  readonly postfx?: boolean;
  /** Units to show instead of the map's markers (a battle in progress). */
  readonly units?: readonly UnitMarker[];
  readonly onUnitHandles?: (handles: ReadonlyMap<string, UnitHandle> | null) => void;
}) {
  const t = layout.terrain;
  const preset = QUALITY_PRESETS[useSettings((s) => s.quality)];
  const heights = useMemo(() => buildHeightTexture(t), [t]);
  const splat = useMemo(() => buildSplatTexture(t, layout.trees, layout.hedges, layout.roads), [t, layout.trees, layout.hedges, layout.roads]);
  const heightsSize = useMemo(() => new Vector2(t.width + 1, t.depth + 1), [t]);
  useEffect(
    () => () => {
      heights.dispose();
      splat.dispose();
    },
    [heights, splat],
  );
  useEffect(() => {
    paintedGlobals.uMapMin.value.set(layout.playable.minX, layout.playable.minZ);
    paintedGlobals.uMapMax.value.set(layout.playable.maxX, layout.playable.maxZ);
  }, [layout]);

  return (
    <>
      <Atmosphere />
      <Sky />
      {t.width > SINGLE_MESH_TERRAIN_CELLS || t.depth > SINGLE_MESH_TERRAIN_CELLS ? <ChunkedTerrain terrain={t} splat={splat} /> : <Terrain terrain={t} splat={splat} />}
      <DistantLandscape terrain={t} seed={layout.name} water={layout.water} />
      <Water bodies={layout.water} heights={heights} heightsSize={heightsSize} />
      <Grass terrain={t} heights={heights} splat={splat} preset={preset} />
      <Vegetation trees={layout.trees} terrain={t} />
      <Fields fields={layout.fields} terrain={t} />
      <Hedges hedges={layout.hedges} terrain={t} />
      {layout.props && layout.props.length > 0 && <Props props={layout.props} terrain={t} />}
      <Castle walls={layout.walls} towers={layout.towers} gates={layout.gates} keeps={layout.keeps} bridges={layout.bridges} water={layout.water} terrain={t} />
      <Suspense fallback={null}>
        <Buildings houses={layout.houses} terrain={t} />
        <Units units={units ?? layout.units} terrain={t} onHandles={onUnitHandles} />
        <SceneReady />
      </Suspense>
      {postfx && <PostFX />}
    </>
  );
}
