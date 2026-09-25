/**
 * "PaintedGrade": the whole colour grade in one effect (brief §7: LUT + vignette in a single
 * fused pass). Equivalent to a procedural LUT: saturation, warm-highlight / cool-shadow split
 * toning, a gentle S-curve, vignette and a static paper grain. Parameters follow the time of day.
 */
import { BlendFunction, Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

const fragmentShader = /* glsl */ `
uniform float uSaturation;
uniform vec3 uShadowTone;
uniform vec3 uHighlightTone;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;

float gradeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c *= mix(uShadowTone, uHighlightTone, smoothstep(0.08, 0.75, l));
  vec3 s = clamp(c, 0.0, 1.0);
  c = mix(c, s * s * (3.0 - 2.0 * s), uContrast);
  vec2 d = (uv - 0.5) * vec2(1.15, 1.0);
  c *= 1.0 - uVignette * smoothstep(0.32, 0.92, length(d));
  // Multiplicative paper grain: never lifts dark flats into grey noise.
  float g = gradeHash(floor(uv * resolution * 0.75));
  c *= 1.0 + (g - 0.5) * 2.0 * uGrain;
  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`;

const exposureShader = /* glsl */ `
uniform float uExposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
}
`;

/** Linear-light gain applied before tone mapping (driven by the time-of-day rig). */
export class ExposureEffect extends Effect {
  constructor(exposure: { value: number }) {
    super('ExposureEffect', exposureShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([['uExposure', exposure as Uniform<number>]]),
    });
  }
}

export interface GradeParams {
  readonly saturation: number;
  readonly warmth: number;
  readonly contrast: number;
  readonly vignette: number;
  readonly grain: number;
}

export const DEFAULT_GRADE: GradeParams = { saturation: 1.0, warmth: 0.07, contrast: 0.12, vignette: 0.22, grain: 0.007 };

export class PaintedGradeEffect extends Effect {
  constructor(params: GradeParams = DEFAULT_GRADE) {
    super('PaintedGradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uSaturation', new Uniform(params.saturation)],
        ['uShadowTone', new Uniform(new Vector3())],
        ['uHighlightTone', new Uniform(new Vector3())],
        ['uContrast', new Uniform(params.contrast)],
        ['uVignette', new Uniform(params.vignette)],
        ['uGrain', new Uniform(params.grain)],
      ]),
    });
    this.setParams(params);
  }

  setParams(params: GradeParams): void {
    const u = this.uniforms;
    (u.get('uSaturation') as Uniform<number>).value = params.saturation;
    // Warm highlights (amber) and cool shadows (blue-violet), both luminance-neutral-ish.
    (u.get('uHighlightTone') as Uniform<Vector3>).value.set(1 + params.warmth, 1 + params.warmth * 0.35, 1 - params.warmth * 0.6);
    (u.get('uShadowTone') as Uniform<Vector3>).value.set(1 - params.warmth * 0.35, 1 - params.warmth * 0.15, 1 + params.warmth * 0.5);
    (u.get('uContrast') as Uniform<number>).value = params.contrast;
    (u.get('uVignette') as Uniform<number>).value = params.vignette;
    (u.get('uGrain') as Uniform<number>).value = params.grain;
  }
}
