import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { useSettings } from '../../state/settings.ts';
import { resolveRig } from '../atmosphere/time-of-day.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { DEFAULT_GRADE, ExposureEffect, PaintedGradeEffect } from './painted-grade.ts';

/** Single fused post pass: SMAA + exposure + ACES tone mapping + painted grade (brief §7). */
export function PostFX() {
  const hour = useSettings((s) => s.hour);
  const grade = useMemo(() => new PaintedGradeEffect(), []);
  const exposure = useMemo(() => new ExposureEffect(paintedGlobals.uExposure), []);
  useEffect(() => {
    const rig = resolveRig(hour);
    grade.setParams({ ...DEFAULT_GRADE, saturation: rig.gradeSaturation, warmth: rig.gradeWarmth });
  }, [grade, hour]);
  useEffect(
    () => () => {
      grade.dispose();
      exposure.dispose();
    },
    [grade, exposure],
  );
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <primitive object={exposure} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={grade} />
    </EffectComposer>
  );
}
