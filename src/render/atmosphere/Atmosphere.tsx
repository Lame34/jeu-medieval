/**
 * Sun + ambient lighting driven by the time of day. The sun is a SunLight: two cascaded shadow
 * maps fitted to the view frustum (ADR-055), crisp near the camera and reaching across everything
 * on screen up to the preset's distance — no more shadows only around the camera's focus.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { HemisphereLight, Matrix4 } from 'three';
import { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import { useSceneConditions, useSceneHour } from '../../state/scene-conditions.ts';
import { applyRigToGlobals, MIST_FOG, paintedGlobals, setActiveFog, WEATHER_FOG } from '../materials/painted-globals.ts';
import { useQualityPreset } from '../quality/use-quality-preset.ts';
import { registerSunFrusta, setShadowView } from './shadow-only.ts';
import { resolveRig } from './time-of-day.ts';

const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.04;
/**
 * The shadow maps are redrawn when the view or the light changes, and otherwise every
 * SHADOW_EVERY frames: the units' idle motion and the swaying leaves read the same at 30 Hz, and
 * the shadow pass was a third of the frame's CPU.
 */
const SHADOW_EVERY = 2;
/**
 * The cascades reach at least the preset's distance from the camera, and this many times its
 * distance to its focus: a view pulled back high over the map keeps its shadows (a reach counted
 * from the camera alone left the whole overview without any), at about the same texels per pixel.
 * Changed only past REACH_STEP of itself (each change redraws the maps).
 */
const SHADOW_REACH_OVER_FOCUS = 1.6;
const REACH_STEP = 0.04;

/** Lit for the scene's hour and weather (a battle's, else the settings' hour under a clear sky). */
export function Atmosphere() {
  const hour = useSceneHour();
  const weather = useSceneConditions((s) => s.weather);
  const mist = useSceneConditions((s) => s.mist);
  const preset = useQualityPreset();
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const rig = useMemo(() => resolveRig(hour, weather), [hour, weather]);
  const shadowFrame = useRef(0);
  const lastView = useRef(new Matrix4());
  const reach = useRef(0);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  // A new light: redraw the shadows now.
  useEffect(() => {
    gl.shadowMap.needsUpdate = true;
  }, [gl, rig]);
  useEffect(() => {
    // Under a clear sky, an autumn morning's mist; the fog and the rain close in on their own.
    setActiveFog(weather === 'clear' && mist ? MIST_FOG : WEATHER_FOG[weather]);
    // Overcast: no cast shadows, and no shadow pass to render; the clouds' shadows only under a broken sky.
    paintedGlobals.uCastShadow.value = weather === 'rain' ? 0 : 1;
    paintedGlobals.uCloudShadow.value = weather === 'clear' ? preset.cloudShadows : 0;
    return () => {
      setActiveFog(WEATHER_FOG.clear);
      paintedGlobals.uCastShadow.value = 1;
      paintedGlobals.uCloudShadow.value = 0;
    };
  }, [weather, mist, preset]);

  const sun = useMemo(() => {
    const light = new SunLight();
    light.castShadow = true;
    light.shadow.bias = SHADOW_BIAS;
    light.shadow.normalBias = SHADOW_NORMAL_BIAS;
    return light;
  }, []);
  const hemi = useMemo(() => new HemisphereLight(), []);

  useEffect(() => {
    scene.add(sun, hemi);
    // The shadow-only meshes (shadow-only.ts) are drawn into these cascades, never in a view.
    const unregister = registerSunFrusta(Array.from({ length: sun.shadow.getViewportCount() }, (_, i) => sun.shadow.getFrustum(i)));
    return () => {
      unregister();
      scene.remove(sun, hemi);
      sun.dispose();
      hemi.dispose();
    };
  }, [scene, sun, hemi]);

  useEffect(() => {
    applyRigToGlobals(rig);
    sun.color.copy(rig.sunColor);
    sun.intensity = rig.sunIntensity;
    // A SunLight shines from its position towards the origin: the position is the sun's direction.
    sun.position.copy(paintedGlobals.uSunDir.value);
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
    sun.shadow.radius = preset.shadowSoftness;
    reach.current = 0;
    gl.shadowMap.needsUpdate = true;
  }, [preset, sun, gl]);

  useFrame(({ camera }, delta) => {
    paintedGlobals.uTime.value += delta;
    setShadowView(camera);
    const wanted = Math.max(preset.shadowDistanceM, camera.position.distanceTo(paintedGlobals.uFocus.value) * SHADOW_REACH_OVER_FOCUS);
    if (Math.abs(wanted - reach.current) > reach.current * REACH_STEP) {
      reach.current = wanted;
      sun.shadow.camera.far = wanted;
      gl.shadowMap.needsUpdate = true;
    }
    // The cascades are fitted to the view when the maps are drawn: redraw them as soon as it moves.
    const moved = !lastView.current.equals(camera.matrixWorld);
    if (moved) lastView.current.copy(camera.matrixWorld);
    if (paintedGlobals.uCastShadow.value > 0 && (moved || ++shadowFrame.current % SHADOW_EVERY === 0)) gl.shadowMap.needsUpdate = true;
  });

  return null;
}
