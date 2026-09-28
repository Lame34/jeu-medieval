/**
 * PaintedMaterial — the single material family of the game (STYLE_BIBLE §4, ADR-010).
 * MeshLambertMaterial + onBeforeCompile: keeps three's maps, vertex colours, instancing,
 * skinning, shadows; replaces lighting (wrap + tinted shadows), adds the painterly albedo
 * treatment (vertical gradient, world-space hue noise, ground-contact AO), optional wind sway,
 * optional rim light (units) and the shared atmospheric fog.
 */
import { Color, MeshLambertMaterial, Vector2, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { PAINTED_FOG_FN, PAINTED_GLOBALS_PARS, PAINTED_LIGHTS_PARS, PAINTED_NOISE, buildPaintedLightsBegin } from './painted-chunks.ts';
import { paintedGlobals } from './painted-globals.ts';

export interface PaintedOptions {
  readonly color?: Color | string;
  readonly map?: Texture | null;
  readonly vertexColors?: boolean;
  /** Local-space height of the object's top (m); drives the vertical gradient. */
  readonly heightM?: number;
  readonly wrap?: number;
  readonly gradientBase?: number;
  readonly gradientTop?: number;
  readonly gradientSaturation?: number;
  readonly hueNoiseScale?: number;
  readonly hueNoiseAmp?: number;
  readonly valueNoiseAmp?: number;
  readonly groundAO?: number;
  readonly groundAOHeightM?: number;
  /** Saturation / value applied to the source albedo (tames over-saturated kit textures). */
  readonly albedoSaturation?: number;
  readonly albedoValue?: number;
  /** Units only: soft rim light that detaches silhouettes from the scenery. */
  readonly rim?: { readonly color: Color | string; readonly strength: number };
  /** Vegetation: vertex sway amplitude (m at the top of the object). */
  readonly windSwayM?: number;
  readonly alphaTest?: number;
  readonly side?: MeshLambertMaterial['side'];
  readonly name?: string;
  /**
   * Replaces the default painterly albedo treatment (terrain, water banks…). `body` runs after
   * three's color_fragment and must write `diffuseColor.rgb`; it can read vPaintedWorldPos,
   * vPaintedHeight and (with `worldNormal`) vPaintedWorldNormal. `key` names the shader variant.
   */
  readonly customAlbedo?: {
    readonly key: string;
    readonly pars: string;
    readonly body: string;
    readonly uniforms: Record<string, { value: unknown }>;
  };
  /**
   * Custom vertex placement (GPU grass…): `body` runs right after three's begin_vertex and may
   * overwrite `transformed` and `vColor`; `pars` declares its uniforms/attributes.
   */
  readonly customVertex?: {
    readonly key: string;
    readonly pars: string;
    readonly body: string;
    readonly uniforms: Record<string, { value: unknown }>;
  };
  /** Exposes the world-space geometric normal to the fragment shader. */
  readonly worldNormal?: boolean;
  /** Vertex attribute `aPaintedData` (vec4) passed through as vPaintedData. */
  readonly vertexData?: boolean;
  /**
   * Double-sided cards (grass, ferns): keep the authored normal on both faces instead of
   * flipping it for back faces, so a blade seen from behind is lit like the ground it grows on.
   */
  readonly keepNormalOnBackFaces?: boolean;
  /** Leaves: brush-stroke light/dark clumps in the albedo. */
  readonly foliage?: boolean;
  /**
   * Tactical cutaway (XCOM rule): fragments right at the camera, or on the line of sight
   * between the camera and its focus, dissolve with an interleaved-gradient dither, so
   * vegetation never walls off the view (shadows are unaffected).
   */
  readonly nearFade?: boolean;
  /** Units (allegiance colours) opt out of the scene saturation ceiling and of the shade hue drift. */
  readonly saturationCeiling?: boolean;
}

/** Defaults from STYLE_BIBLE §4. */
export const PAINTED_DEFAULTS = {
  wrap: 0.45,
  gradientBase: 0.72,
  gradientTop: 1.08,
  gradientSaturation: 0.12,
  hueNoiseScale: 1 / 45,
  hueNoiseAmp: 0.035,
  valueNoiseAmp: 0.07,
  groundAO: 0.35,
  groundAOHeightM: 0.6,
  heightM: 2,
} as const;

let cachedLightsBegin: string | null = null;
function paintedLightsBegin(): string {
  cachedLightsBegin ??= buildPaintedLightsBegin();
  return cachedLightsBegin;
}

const VERTEX_PARS = /* glsl */ `
${PAINTED_GLOBALS_PARS}
${PAINTED_NOISE}
uniform vec2 uBoundsY;
uniform float uWindSway;
varying vec3 vPaintedWorldPos;
varying float vPaintedHeight;
#ifdef PAINTED_WORLD_NORMAL
varying vec3 vPaintedWorldNormal;
#endif
#ifdef PAINTED_VERTEX_DATA
attribute vec4 aPaintedData;
varying vec4 vPaintedData;
#endif
`;

const VERTEX_EXTRA = /* glsl */ `
#ifdef PAINTED_WORLD_NORMAL
vPaintedWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
#endif
#ifdef PAINTED_VERTEX_DATA
// Merged meshes (houses, walls) carry their own "height above the building base" in x.
vPaintedData = aPaintedData;
vPaintedHeight = aPaintedData.x;
#endif
`;

const VERTEX_WIND = /* glsl */ `
#ifdef PAINTED_WIND
{
  vec4 baseW = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_BATCHING
  baseW = batchingMatrix * baseW;
  #endif
  #ifdef USE_INSTANCING
  baseW = instanceMatrix * baseW;
  #endif
  baseW = modelMatrix * baseW;
  float h = clamp(position.y / max(uBoundsY.y, 1e-3), 0.0, 1.0);
  float phase = dot(baseW.xz, vec2(0.071, 0.053));
  float gust = sin(uTime * 1.3 + phase) * 0.6 + sin(uTime * 2.9 + phase * 1.7) * 0.25 + 0.35;
  vec3 worldOffset = vec3(uWindDir.x, 0.0, uWindDir.y) * (uWindSway * uWindStrength * gust * h * h);
  mat3 toWorld = mat3(modelMatrix);
  #ifdef USE_INSTANCING
  toWorld = toWorld * mat3(instanceMatrix);
  #endif
  #ifdef USE_BATCHING
  toWorld = toWorld * mat3(batchingMatrix);
  #endif
  transformed += inverse(toWorld) * worldOffset;
}
#endif
`;

const VERTEX_WORLD = /* glsl */ `
{
  vec4 pW = vec4(transformed, 1.0);
  vec4 pB = vec4(0.0, 0.0, 0.0, 1.0);
  // Same order as three's project_vertex: model · instance · batching.
  #ifdef USE_BATCHING
  pW = batchingMatrix * pW;
  pB = batchingMatrix * pB;
  #endif
  #ifdef USE_INSTANCING
  pW = instanceMatrix * pW;
  pB = instanceMatrix * pB;
  #endif
  pW = modelMatrix * pW;
  pB = modelMatrix * pB;
  vPaintedWorldPos = pW.xyz;
  vPaintedHeight = pW.y - pB.y;
}
`;

const FRAGMENT_PARS = /* glsl */ `
${PAINTED_GLOBALS_PARS}
${PAINTED_NOISE}
${PAINTED_FOG_FN}
uniform vec2 uBoundsY;
uniform float uGradBase;
uniform float uGradTop;
uniform float uGradSat;
uniform float uHueNoiseScale;
uniform float uHueNoiseAmp;
uniform float uValueNoiseAmp;
uniform float uGroundAO;
uniform float uGroundAOHeight;
uniform float uAlbedoSat;
uniform float uAlbedoVal;
uniform vec3 uRimColor;
uniform float uRimStrength;
varying vec3 vPaintedWorldPos;
varying float vPaintedHeight;
#ifdef PAINTED_WORLD_NORMAL
varying vec3 vPaintedWorldNormal;
#endif
#ifdef PAINTED_VERTEX_DATA
varying vec4 vPaintedData;
#endif
`;

const FRAGMENT_ALBEDO = /* glsl */ `
{
  float h01 = clamp(vPaintedHeight / max(uBoundsY.y, 1e-3), 0.0, 1.0);
  vec3 c = diffuseColor.rgb;
  c = mix(vec3(paintedLuma(c)), c, uAlbedoSat) * uAlbedoVal;
  float l = paintedLuma(c);
  c = max(mix(vec3(l), c, 1.0 + uGradSat * (1.0 - h01)), 0.0);
  c *= mix(uGradBase, uGradTop, smoothstep(0.0, 1.0, h01));
  float n = paintedFbm(vPaintedWorldPos.xz * uHueNoiseScale);
  c = max(paintedHueShift(c, (n - 0.5) * 2.0 * uHueNoiseAmp), 0.0);
  c *= 1.0 + (n - 0.5) * 2.0 * uValueNoiseAmp;
  c *= mix(1.0 - uGroundAO, 1.0, smoothstep(0.0, uGroundAOHeight, vPaintedHeight));
  #ifdef PAINTED_FOLIAGE
  // Brush-stroke clumps of light and dark leaves (world space, ~0.7 m strokes).
  float stroke = smoothstep(0.45, 0.6, paintedValueNoise(vPaintedWorldPos.xz * 1.4 + vPaintedWorldPos.y * 1.1));
  c *= mix(0.84, 1.1, stroke);
  #endif
  #ifdef PAINTED_VERTEX_DATA
  // Per-building variation (y: hue, z: value) so merged repeats never look copy-pasted.
  c = max(paintedHueShift(c, vPaintedData.y * 0.025), 0.0);
  c *= 1.0 + vPaintedData.z * 0.07;
  // w = 1 marks thatch: straw strands running down the slope, ±8 % value.
  float strand = paintedValueNoise(vec2((vPaintedWorldPos.x + vPaintedWorldPos.z) * 7.0, vPaintedWorldPos.y * 0.9));
  c *= mix(1.0, 0.92 + 0.16 * strand, step(0.5, vPaintedData.w));
  #endif
  diffuseColor.rgb = c;
}
`;

/** HSV saturation ceiling of everything but the allegiance colours (STYLE_BIBLE §2). */
const MAX_SCENE_SATURATION = 0.52;

/** Cutaway (m): the camera sphere (dissolved below START, opaque beyond END) and the
 * line-of-sight cylinder (radius, fade width), which spares the last part near the focus. */
const NEAR_FADE_START_M = 2.5;
const NEAR_FADE_END_M = 4.5;
const SIGHT_RADIUS_M = 2.5;
const SIGHT_FADE_M = 1.0;
const SIGHT_SPARED_FRACTION = 0.15;

const FRAGMENT_NEAR_FADE = /* glsl */ `
#ifdef PAINTED_NEAR_FADE
{
  vec3 toFrag = vPaintedWorldPos - cameraPosition;
  vec3 sight = uFocus - cameraPosition;
  float t = clamp(dot(toFrag, sight) / max(dot(sight, sight), 1e-4), 0.0, 1.0);
  float offSight = distance(vPaintedWorldPos, cameraPosition + sight * t);
  // Only when zoomed in (the XCOM case): from afar the line of sight crosses scenery, not walls of leaves.
  float closeUp = 1.0 - smoothstep(15.0, 25.0, length(sight));
  float occluder = closeUp * (1.0 - smoothstep(${SIGHT_RADIUS_M.toFixed(1)}, ${(SIGHT_RADIUS_M + SIGHT_FADE_M).toFixed(1)}, offSight)) * (1.0 - smoothstep(${(1 - SIGHT_SPARED_FRACTION - 0.05).toFixed(2)}, ${(1 - SIGHT_SPARED_FRACTION).toFixed(2)}, t));
  float nearCam = 1.0 - smoothstep(${NEAR_FADE_START_M.toFixed(1)}, ${NEAR_FADE_END_M.toFixed(1)}, length(toFrag));
  float dissolve = max(occluder, nearCam);
  // Interleaved gradient noise (Jimenez 2014): far less visible than a Bayer matrix.
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (dissolve > 0.0 && dissolve >= ign) discard;
}
#endif
`;

const FRAGMENT_RIM = /* glsl */ `
#ifdef PAINTED_RIM
{
  // Warm rim in the sun, cool sky-tinted and weaker in the shade (review v15: a warm rim at
  // full strength in the shade turned pale cloth milky white).
  float rim = pow(1.0 - clamp(dot(normal, geometryViewDir), 0.0, 1.0), 3.0);
  vec3 rimColor = mix(uHorizonAway * 1.1, uRimColor, paintedSunLit);
  reflectedLight.directDiffuse += rimColor * rim * uRimStrength * (0.45 + 0.55 * paintedSunLit);
}
#endif
`;

function inject(source: string, anchor: string, code: string, position: 'before' | 'after' | 'replace'): string {
  const include = `#include <${anchor}>`;
  if (!source.includes(include)) throw new Error(`PaintedMaterial: anchor ${include} not found.`);
  const replacement = position === 'replace' ? code : position === 'before' ? `${code}\n${include}` : `${include}\n${code}`;
  return source.replace(include, replacement);
}

export type PaintedMaterial = MeshLambertMaterial & {
  readonly userData: { painted: { uniforms: Record<string, { value: unknown }> } };
};

export function createPaintedMaterial(options: PaintedOptions = {}): PaintedMaterial {
  const material = new MeshLambertMaterial({
    color: options.color ?? '#ffffff',
    map: options.map ?? null,
    vertexColors: options.vertexColors ?? false,
    alphaTest: options.alphaTest ?? 0,
    name: options.name ?? 'Painted',
  }) as PaintedMaterial;
  if (options.side !== undefined) material.side = options.side;

  const heightM = options.heightM ?? PAINTED_DEFAULTS.heightM;
  const local = {
    uWrap: { value: options.wrap ?? PAINTED_DEFAULTS.wrap },
    uBoundsY: { value: new Vector2(0, heightM) },
    uGradBase: { value: options.gradientBase ?? PAINTED_DEFAULTS.gradientBase },
    uGradTop: { value: options.gradientTop ?? PAINTED_DEFAULTS.gradientTop },
    uGradSat: { value: options.gradientSaturation ?? PAINTED_DEFAULTS.gradientSaturation },
    uHueNoiseScale: { value: options.hueNoiseScale ?? PAINTED_DEFAULTS.hueNoiseScale },
    uHueNoiseAmp: { value: options.hueNoiseAmp ?? PAINTED_DEFAULTS.hueNoiseAmp },
    uValueNoiseAmp: { value: options.valueNoiseAmp ?? PAINTED_DEFAULTS.valueNoiseAmp },
    uGroundAO: { value: options.groundAO ?? PAINTED_DEFAULTS.groundAO },
    uGroundAOHeight: { value: options.groundAOHeightM ?? PAINTED_DEFAULTS.groundAOHeightM },
    uAlbedoSat: { value: options.albedoSaturation ?? 1 },
    uAlbedoVal: { value: options.albedoValue ?? 1 },
    uRimColor: { value: materialColor(options.rim?.color ?? '#fff1d6') },
    uRimStrength: { value: options.rim?.strength ?? 0 },
    uWindSway: { value: options.windSwayM ?? 0 },
  };
  const custom = options.customAlbedo;
  const customVertex = options.customVertex;
  const uniforms = { ...local, ...(custom?.uniforms ?? {}), ...(customVertex?.uniforms ?? {}) };
  material.userData.painted = { uniforms };

  const defines: string[] = [];
  if (options.rim) defines.push('PAINTED_RIM');
  if (options.windSwayM) defines.push('PAINTED_WIND');
  if (options.worldNormal) defines.push('PAINTED_WORLD_NORMAL');
  if (options.vertexData) defines.push('PAINTED_VERTEX_DATA');
  if (options.keepNormalOnBackFaces) defines.push('PAINTED_KEEP_BACK_NORMAL');
  if (options.foliage) defines.push('PAINTED_FOLIAGE');
  if (options.nearFade) defines.push('PAINTED_NEAR_FADE');
  if (options.saturationCeiling !== false) defines.push('PAINTED_SAT_CEILING');
  else defines.push('PAINTED_ALLEGIANCE');
  material.defines = Object.fromEntries(defines.map((d) => [d, '']));

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, paintedGlobals, uniforms);
    let vs = shader.vertexShader;
    vs = inject(vs, 'common', VERTEX_PARS + (customVertex?.pars ?? ''), 'after');
    vs = inject(vs, 'begin_vertex', (customVertex?.body ?? '') + VERTEX_WIND, 'after');
    vs = inject(vs, 'project_vertex', VERTEX_WORLD + VERTEX_EXTRA, 'after');
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = inject(fs, 'common', FRAGMENT_PARS + (custom?.pars ?? ''), 'after');
    fs = inject(fs, 'lights_lambert_pars_fragment', PAINTED_LIGHTS_PARS, 'replace');
    fs = inject(fs, 'clipping_planes_fragment', FRAGMENT_NEAR_FADE, 'after');
    fs = inject(fs, 'normal_fragment_begin', '#ifdef PAINTED_KEEP_BACK_NORMAL\nnormal = normalize(vNormal);\n#endif', 'after');
    fs = inject(fs, 'color_fragment', custom ? custom.body : FRAGMENT_ALBEDO, 'after');
    fs = inject(fs, 'lights_fragment_begin', paintedLightsBegin(), 'replace');
    fs = inject(fs, 'lights_fragment_end', FRAGMENT_RIM, 'after');
    fs = inject(fs, 'fog_fragment', `#ifdef PAINTED_SAT_CEILING
gl_FragColor.rgb = paintedSaturationCeiling(gl_FragColor.rgb, ${MAX_SCENE_SATURATION.toFixed(2)});
#endif
gl_FragColor.rgb = paintedApplyFog(gl_FragColor.rgb, vPaintedWorldPos);`, 'replace');
    shader.fragmentShader = fs;
  };
  // One program per feature combination; values live in uniforms.
  material.customProgramCacheKey = () => `painted-v1|${custom?.key ?? 'default'}|${customVertex?.key ?? 'mesh'}|${defines.join(',')}`;
  return material;
}

function materialColor(value: Color | string): Color {
  return new Color(value);
}
