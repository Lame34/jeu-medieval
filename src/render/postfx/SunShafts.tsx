/**
 * Shafts of sunlight (high preset, ADR-055): when the sun is low and in view, its light streams
 * between the towers, the merlons and the trees. A sun disc, never drawn in the scene itself, is
 * masked by the scene's depth and blurred towards its screen position (postprocessing's
 * GodRaysEffect). The shafts follow the hour (strongest at dawn and dusk, none at night) and the
 * weather (none under rain or fog; the autumn morning's mist makes them thicker).
 */
import { useFrame, useThree } from '@react-three/fiber';
import { BlendFunction, GodRaysEffect, KernelSize } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { smoothstep } from '../../core/math/scalar.ts';
import { useSceneConditions } from '../../state/scene-conditions.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';

/** The disc stands this far along the sun's direction from the camera (within its far plane), this big. */
const SUN_DISTANCE_M = 3000;
const SUN_RADIUS_M = 110;
const SHAFT_SAMPLES = 48;
const SHAFT_DENSITY = 0.94;
const SHAFT_DECAY = 0.93;
const SHAFT_WEIGHT = 0.55;
/** Exposure of the shafts at their strongest (a low sun under a clear sky). */
const SHAFT_EXPOSURE = 0.5;
/** The shafts fade as the sun climbs (sin of its elevation) and with its strength (night: none). */
const LOW_SUN_FULL = 0.22;
const LOW_SUN_NONE = 0.62;
const SUN_SHARE_NONE = 0.45;
const SUN_SHARE_FULL = 0.62;
const MIST_THICKENING = 1.35;

export function SunShafts() {
  const camera = useThree((s) => s.camera);
  const weather = useSceneConditions((s) => s.weather);
  const mist = useSceneConditions((s) => s.mist);
  const built = useMemo(() => {
    const disc = new Mesh(new SphereGeometry(SUN_RADIUS_M, 16, 8), new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, fog: false }));
    disc.frustumCulled = false;
    const effect = new GodRaysEffect(camera, disc, {
      blendFunction: BlendFunction.SCREEN,
      samples: SHAFT_SAMPLES,
      density: SHAFT_DENSITY,
      decay: SHAFT_DECAY,
      weight: SHAFT_WEIGHT,
      exposure: 0,
      clampMax: 1,
      resolutionScale: 0.5,
      blur: true,
      kernelSize: KernelSize.SMALL,
    });
    return { disc, effect };
  }, [camera]);
  useEffect(
    () => () => {
      built.effect.dispose();
      built.disc.geometry.dispose();
      built.disc.material.dispose();
    },
    [built],
  );
  useFrame(({ camera: view }) => {
    const dir = paintedGlobals.uSunDir.value;
    built.disc.position.copy(view.position).addScaledVector(dir, SUN_DISTANCE_M);
    built.disc.updateMatrixWorld();
    built.disc.material.color.copy(paintedGlobals.uSunColor.value);
    const sky = weather === 'clear' ? (mist ? MIST_THICKENING : 1) : 0;
    const low = smoothstep(0, 0.04, dir.y) * (1 - smoothstep(LOW_SUN_FULL, LOW_SUN_NONE, dir.y));
    const day = smoothstep(SUN_SHARE_NONE, SUN_SHARE_FULL, paintedGlobals.uSunShare.value);
    built.effect.godRaysMaterial.exposure = SHAFT_EXPOSURE * sky * low * day;
  });
  return <primitive object={built.effect} />;
}
