import { Bloom, EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, type EffectComposer as EffectComposerImpl } from 'postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import { useSceneConditions, useSceneHour } from '../../state/scene-conditions.ts';
import { DynamicResolution } from '../quality/DynamicResolution.tsx';
import { useQualityPreset } from '../quality/use-quality-preset.ts';
import { resolveRig } from '../atmosphere/time-of-day.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { AmbientOcclusion } from './AmbientOcclusion.tsx';
import { DEFAULT_GRADE, ExposureEffect, PaintedGradeEffect } from './painted-grade.ts';
import { SunShafts } from './SunShafts.tsx';

/** Bloom: how soft the knee above the threshold is. */
const BLOOM_SMOOTHING = 0.25;

/**
 * The post chain (brief §7, ADR-055): ambient occlusion (medium, high), SMAA, exposure, a soft
 * bloom (medium, high), the sun's shafts (high), ACES tone mapping and the painted grade.
 */
export function PostFX() {
  const hour = useSceneHour();
  const weather = useSceneConditions((s) => s.weather);
  const preset = useQualityPreset();
  const composer = useRef<EffectComposerImpl | null>(null);
  const range = useMemo(() => ({ min: preset.minRenderScale, max: 1 }), [preset]);
  const grade = useMemo(() => new PaintedGradeEffect(), []);
  const exposure = useMemo(() => new ExposureEffect(paintedGlobals.uExposure), []);
  useEffect(() => {
    const rig = resolveRig(hour, weather);
    grade.setParams({ ...DEFAULT_GRADE, saturation: rig.gradeSaturation, warmth: rig.gradeWarmth });
  }, [grade, hour, weather]);
  useEffect(
    () => () => {
      grade.dispose();
      exposure.dispose();
    },
    [grade, exposure],
  );
  const ao = preset.ambientOcclusion;
  const bloom = preset.bloom;
  return (
    <>
      <EffectComposer ref={composer} multisampling={0} enableNormalPass={false}>
        {ao && <AmbientOcclusion settings={ao} />}
        <SMAA />
        <primitive object={exposure} />
        {bloom && <Bloom mipmapBlur intensity={bloom.intensity} luminanceThreshold={bloom.threshold} luminanceSmoothing={BLOOM_SMOOTHING} />}
        {preset.godRays && <SunShafts />}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <primitive object={grade} />
      </EffectComposer>
      <DynamicResolution composer={composer} range={range} />
    </>
  );
}
