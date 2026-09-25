import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { useSettings } from '../../state/settings.ts';
import { resolveRig } from '../atmosphere/time-of-day.ts';
import { DEFAULT_GRADE, PaintedGradeEffect } from './painted-grade.ts';

/** Single fused post pass: SMAA + ACES tone mapping + painted grade (brief §7). */
export function PostFX() {
  const hour = useSettings((s) => s.hour);
  const grade = useMemo(() => new PaintedGradeEffect(), []);
  useEffect(() => {
    const rig = resolveRig(hour);
    grade.setParams({ ...DEFAULT_GRADE, saturation: rig.gradeSaturation, warmth: rig.gradeWarmth });
  }, [grade, hour]);
  useEffect(() => () => grade.dispose(), [grade]);
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={grade} />
    </EffectComposer>
  );
}
