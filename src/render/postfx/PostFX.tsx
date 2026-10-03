import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, type EffectComposer as EffectComposerImpl } from 'postprocessing';
import { useEffect, useMemo, useRef } from 'react';
import { useSceneConditions, useSceneHour } from '../../state/scene-conditions.ts';
import { useSettings } from '../../state/settings.ts';
import { DynamicResolution } from '../quality/DynamicResolution.tsx';
import { QUALITY_PRESETS } from '../quality/presets.ts';
import { resolveRig } from '../atmosphere/time-of-day.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { DEFAULT_GRADE, ExposureEffect, PaintedGradeEffect } from './painted-grade.ts';

/** Single fused post pass: SMAA + exposure + ACES tone mapping + painted grade (brief §7). */
export function PostFX() {
  const hour = useSceneHour();
  const weather = useSceneConditions((s) => s.weather);
  const preset = QUALITY_PRESETS[useSettings((s) => s.quality)];
  const composer = useRef<EffectComposerImpl | null>(null);
  const range = useMemo(() => ({ min: preset.minRenderScale, max: preset.maxRenderScale }), [preset]);
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
  return (
    <>
      <EffectComposer ref={composer} multisampling={0} enableNormalPass={false}>
        <SMAA />
        <primitive object={exposure} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <primitive object={grade} />
      </EffectComposer>
      <DynamicResolution composer={composer} range={range} />
    </>
  );
}
