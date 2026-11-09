/** The preset the scene is drawn at: the URL's (?preset=), else the player's option (ADR-055). */
import { useSettings } from '../../state/settings.ts';
import { PRESET_OVERRIDE, QUALITY_PRESETS, type QualityPreset } from './presets.ts';

export function useQualityPreset(): QualityPreset {
  const quality = useSettings((s) => s.quality);
  return QUALITY_PRESETS[PRESET_OVERRIDE ?? quality];
}
