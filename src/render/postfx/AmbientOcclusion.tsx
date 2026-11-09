/**
 * Screen-space ambient occlusion (N8AO, medium and high presets, ADR-055): the soft contact shade
 * where a wall meets the ground, under the eaves, between the merlons, at a man's feet. It takes
 * the painted shade's blue-violet rather than black, so it reads as the shadows' washes do.
 */
import { N8AO } from '@react-three/postprocessing';
import { useCallback } from 'react';
import { Color } from 'three';
import type { AmbientOcclusionSettings } from '../quality/presets.ts';

const AO_COLOR = new Color('#2a2742');
/** How fast the occlusion fades with the depth gap (in metres of the radius). */
const AO_DISTANCE_FALLOFF = 1;

interface N8AOConfiguration {
  gammaCorrection: boolean;
}

export function AmbientOcclusion({ settings }: { readonly settings: AmbientOcclusionSettings }) {
  // n8ao converts its output to sRGB by default; here the chain stays linear until the tone mapping.
  const linear = useCallback((pass: { readonly configuration: N8AOConfiguration } | null) => {
    if (pass) pass.configuration.gammaCorrection = false;
  }, []);
  return <N8AO ref={linear} aoRadius={settings.radiusM} intensity={settings.intensity} halfRes={settings.halfRes} quality={settings.quality} distanceFalloff={AO_DISTANCE_FALLOFF} color={AO_COLOR} />;
}
