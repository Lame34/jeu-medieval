/**
 * Sun + ambient lighting driven by the time of day. The sun's shadow frustum is a tight box
 * that follows the camera focus (brief §7): crisp shadows where the player looks, one map.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DirectionalLight, HemisphereLight, Object3D, Vector3 } from 'three';
import { useSettings } from '../../state/settings.ts';
import { applyRigToGlobals, paintedGlobals } from '../materials/painted-globals.ts';
import { QUALITY_PRESETS } from '../quality/presets.ts';
import { resolveRig } from './time-of-day.ts';

const SUN_DISTANCE_M = 400;
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.04;
/** Snap the shadow frustum to texel-sized steps to avoid shimmering when the camera moves. */
const SHADOW_SNAP = true;
const MIN_SHADOW_RADIUS_M = 26;
const SHADOW_RADIUS_PER_DISTANCE = 1.25;
const SHADOW_RADIUS_HYSTERESIS = 0.08;

export function Atmosphere() {
  const hour = useSettings((s) => s.hour);
  const preset = QUALITY_PRESETS[useSettings((s) => s.quality)];
  const scene = useThree((s) => s.scene);
  const rig = useMemo(() => resolveRig(hour), [hour]);

  const sun = useMemo(() => {
    const light = new DirectionalLight();
    light.castShadow = true;
    light.shadow.bias = SHADOW_BIAS;
    light.shadow.normalBias = SHADOW_NORMAL_BIAS;
    return light;
  }, []);
  const hemi = useMemo(() => new HemisphereLight(), []);
  const sunTarget = useMemo(() => new Object3D(), []);
  const scratch = useRef(new Vector3());

  useEffect(() => {
    sun.target = sunTarget;
    scene.add(sun, sunTarget, hemi);
    return () => {
      scene.remove(sun, sunTarget, hemi);
      sun.dispose();
      hemi.dispose();
    };
  }, [scene, sun, sunTarget, hemi]);

  useEffect(() => {
    applyRigToGlobals(rig);
    sun.color.copy(rig.sunColor);
    sun.intensity = rig.sunIntensity;
    hemi.color.copy(rig.ambientSky);
    hemi.groundColor.copy(rig.ambientGround);
    hemi.intensity = rig.ambientIntensity;
  }, [rig, sun, hemi]);

  useEffect(() => {
    const size = preset.shadowMapSize;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    const cam = sun.shadow.camera;
    cam.left = -preset.shadowRadiusM;
    cam.right = preset.shadowRadiusM;
    cam.top = preset.shadowRadiusM;
    cam.bottom = -preset.shadowRadiusM;
    cam.near = 1;
    cam.far = SUN_DISTANCE_M * 2;
    cam.updateProjectionMatrix();
  }, [preset, sun]);

  useFrame(({ camera }, delta) => {
    paintedGlobals.uTime.value += delta;
    const focus = paintedGlobals.uFocus.value;
    const dir = paintedGlobals.uSunDir.value;
    // Tighten the shadow box when zoomed in: shadow texels are spent where the player looks.
    const radius = Math.min(preset.shadowRadiusM, Math.max(MIN_SHADOW_RADIUS_M, camera.position.distanceTo(focus) * SHADOW_RADIUS_PER_DISTANCE));
    const cam = sun.shadow.camera;
    if (Math.abs(cam.right - radius) > radius * SHADOW_RADIUS_HYSTERESIS) {
      cam.left = -radius;
      cam.right = radius;
      cam.top = radius;
      cam.bottom = -radius;
      cam.updateProjectionMatrix();
    }
    const target = scratch.current.copy(focus);
    if (SHADOW_SNAP) {
      const texel = (2 * cam.right) / preset.shadowMapSize;
      target.set(Math.round(target.x / texel) * texel, target.y, Math.round(target.z / texel) * texel);
    }
    sunTarget.position.copy(target);
    sun.position.copy(target).addScaledVector(dir, SUN_DISTANCE_M);
    sunTarget.updateMatrixWorld();
  });

  return null;
}
