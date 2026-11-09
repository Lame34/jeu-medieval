/**
 * Quality presets (brief §7, ADR-055). "portable" (Faible) is the default and the one held to the
 * budgets on the Intel Arc: everything the battle shows is there, nothing is missing at the edges
 * of the screen. "medium" adds ambient occlusion at half resolution, a soft bloom and the clouds'
 * shadows; "high" draws the scene at 1.25× (60 FPS on an RTX 500 laptop GPU, 38 at 1.5×), softer
 * shadows that reach farther, sun shafts at the low hours, the moat's mirror, and denser, farther
 * grass and wheat.
 */
export const QUALITY_PRESET_IDS = ['portable', 'medium', 'high'] as const;
export type QualityPresetId = (typeof QUALITY_PRESET_IDS)[number];

/** Screen-space ambient occlusion (N8AO): radius in metres, strength, and whether it runs at half resolution. */
export interface AmbientOcclusionSettings {
  readonly radiusM: number;
  readonly intensity: number;
  readonly halfRes: boolean;
  readonly quality: 'performance' | 'low' | 'medium' | 'high' | 'ultra';
}

export interface BloomSettings {
  readonly intensity: number;
  /** Luminance (after exposure) from which a pixel glows. */
  readonly threshold: number;
}

export interface QualityPreset {
  readonly id: QualityPresetId;
  readonly label: string;
  /** Hard cap on the device pixel ratio the scene is drawn at. */
  readonly maxDpr: number;
  /** Supersampling: the scene is drawn at this many times the screen's pixel ratio (within maxDpr). */
  readonly renderScale: number;
  /** Dynamic resolution (?dynres): lowest render scale. */
  readonly minRenderScale: number;
  /**
   * Sun shadows: size of each of the two cascades' maps, how far at least they reach from the camera
   * (farther as the view pulls back, Atmosphere.tsx), their softness (PCF radius, texels).
   */
  readonly shadowMapSize: number;
  readonly shadowDistanceM: number;
  readonly shadowSoftness: number;
  /**
   * Grass: blades per m² in the near carpet, its half-size (m), how many rings of doubled spacing
   * extend it, the distance from the camera at which the blades have faded (m), and whether they are
   * curved (three triangles) rather than straight.
   */
  readonly grassDensityPerM2: number;
  readonly grassRadiusM: number;
  readonly grassRings: number;
  readonly grassFadeM: number;
  readonly grassCurved: boolean;
  /** Wheat: tufts within this distance of the camera (m), the fields' painted mass beyond. */
  readonly wheatTuftsM: number;
  /** Trees and bushes: detailed geometry within this distance of the camera (m). */
  readonly treeDetailM: number;
  readonly ambientOcclusion: AmbientOcclusionSettings | null;
  readonly bloom: BloomSettings | null;
  /** Shafts of sunlight through the towers and the trees when the sun is low. */
  readonly godRays: boolean;
  /** Strength of the drifting clouds' shadows on the land (0: none). */
  readonly cloudShadows: number;
  /** The still water mirrors the scene, at this share of the drawing buffer's resolution (null: painted reflections only). */
  readonly waterMirror: number | null;
}

export const QUALITY_PRESETS: Readonly<Record<QualityPresetId, QualityPreset>> = {
  portable: {
    id: 'portable',
    label: 'Faible',
    maxDpr: 1,
    renderScale: 1,
    minRenderScale: 0.67,
    shadowMapSize: 2048,
    shadowDistanceM: 160,
    shadowSoftness: 1,
    grassDensityPerM2: 10,
    grassRadiusM: 45,
    grassRings: 1,
    grassFadeM: 70,
    grassCurved: false,
    wheatTuftsM: 40,
    treeDetailM: 60,
    ambientOcclusion: null,
    bloom: null,
    godRays: false,
    cloudShadows: 0,
    waterMirror: null,
  },
  medium: {
    id: 'medium',
    label: 'Moyenne',
    maxDpr: 1.25,
    renderScale: 1,
    minRenderScale: 0.75,
    shadowMapSize: 2048,
    shadowDistanceM: 340,
    shadowSoftness: 1.6,
    grassDensityPerM2: 14,
    grassRadiusM: 45,
    grassRings: 2,
    grassFadeM: 85,
    grassCurved: false,
    wheatTuftsM: 60,
    treeDetailM: 85,
    ambientOcclusion: { radiusM: 2.4, intensity: 1.6, halfRes: true, quality: 'low' },
    bloom: { intensity: 0.35, threshold: 0.92 },
    godRays: false,
    cloudShadows: 0.22,
    waterMirror: null,
  },
  high: {
    id: 'high',
    label: 'Haute',
    maxDpr: 2,
    renderScale: 1.25,
    minRenderScale: 1,
    shadowMapSize: 4096,
    shadowDistanceM: 480,
    shadowSoftness: 2.4,
    grassDensityPerM2: 16,
    grassRadiusM: 50,
    grassRings: 2,
    grassFadeM: 110,
    grassCurved: true,
    wheatTuftsM: 90,
    treeDetailM: 130,
    ambientOcclusion: { radiusM: 3, intensity: 2, halfRes: true, quality: 'medium' },
    bloom: { intensity: 0.5, threshold: 0.88 },
    godRays: true,
    cloudShadows: 0.3,
    waterMirror: 0.5,
  },
};

/**
 * `?preset=portable|medium|high` draws this page at that preset whatever the options say (captures,
 * benches, tests); an unknown value is ignored. Not saved: the player's option is left as it is.
 */
export const PRESET_OVERRIDE: QualityPresetId | null = (() => {
  if (typeof window === 'undefined') return null;
  const asked = new URLSearchParams(window.location.search).get('preset');
  return (QUALITY_PRESET_IDS as readonly string[]).includes(asked ?? '') ? (asked as QualityPresetId) : null;
})();

