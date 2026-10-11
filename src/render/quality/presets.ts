/** Quality presets (brief §7). "portable" is the default and the one held to the budgets. */
export const QUALITY_PRESET_IDS = ['portable', 'medium', 'high'] as const;
export type QualityPresetId = (typeof QUALITY_PRESET_IDS)[number];

export interface QualityPreset {
  readonly id: QualityPresetId;
  readonly label: string;
  /** Hard cap on device pixel ratio. */
  readonly maxDpr: number;
  /** Dynamic resolution range (fraction of the capped DPR). */
  readonly minRenderScale: number;
  readonly maxRenderScale: number;
  readonly shadowMapSize: number;
  /** Half-extent (m) of the sun shadow frustum around the camera focus. */
  readonly shadowRadiusM: number;
  /** Radius (m) around the camera focus where grass blades are drawn. */
  readonly grassRadiusM: number;
  readonly grassDensityPerM2: number;
  /** Distances (m) at which vegetation switches LOD0 → LOD1 → impostor. */
  readonly vegetationLod1M: number;
  readonly vegetationImpostorM: number;
  readonly bloom: boolean;
  readonly maxDynamicLights: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityPresetId, QualityPreset>> = {
  portable: {
    id: 'portable',
    label: 'Légère',
    maxDpr: 1,
    minRenderScale: 0.67,
    maxRenderScale: 1,
    shadowMapSize: 2048,
    shadowRadiusM: 70,
    grassRadiusM: 45,
    grassDensityPerM2: 10,
    vegetationLod1M: 55,
    vegetationImpostorM: 140,
    bloom: false,
    maxDynamicLights: 4,
  },
  medium: {
    id: 'medium',
    label: 'Moyenne',
    maxDpr: 1.25,
    minRenderScale: 0.75,
    maxRenderScale: 1,
    shadowMapSize: 2048,
    shadowRadiusM: 90,
    grassRadiusM: 60,
    grassDensityPerM2: 16,
    vegetationLod1M: 75,
    vegetationImpostorM: 190,
    bloom: true,
    maxDynamicLights: 6,
  },
  high: {
    id: 'high',
    label: 'Haute',
    maxDpr: 1.5,
    minRenderScale: 0.85,
    maxRenderScale: 1,
    shadowMapSize: 4096,
    shadowRadiusM: 110,
    grassRadiusM: 80,
    grassDensityPerM2: 24,
    vegetationLod1M: 100,
    vegetationImpostorM: 260,
    bloom: true,
    maxDynamicLights: 8,
  },
};

const INTEGRATED_GPU_PATTERN = /intel|iris|uhd|radeon\(tm\) graphics|vega|apple m\d|mali|adreno|swiftshader/i;

/** First-launch suggestion from the GPU renderer string (refined later by a frame-time probe). */
export function suggestPreset(rendererString: string): QualityPresetId {
  return INTEGRATED_GPU_PATTERN.test(rendererString) ? 'portable' : 'medium';
}
