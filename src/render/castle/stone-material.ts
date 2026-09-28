/**
 * Procedural masonry (brief §6.2): coursed stones laid out in world space on each face,
 * mortar joints, per-stone tone variation, moss creeping up from the base and damp streaks
 * running down from the crenels. No texture, no tiling.
 */
import { Color } from 'three';
import { PALETTE } from '../materials/palette.ts';
import { createPaintedMaterial, type PaintedMaterial } from '../materials/painted-material.ts';

const STONE_PARS = /* glsl */ `
uniform vec3 uStoneLit;
uniform vec3 uStoneBase;
uniform vec3 uMortar;
uniform vec3 uMoss;
uniform float uCourseM;
uniform float uWallHeightM;
`;

const STONE_ALBEDO = /* glsl */ `
{
  vec3 p = vPaintedWorldPos;
  vec3 n = normalize(vPaintedWorldNormal);
  float h = vPaintedData.x;
  // Arc length along the wall / around the tower (continuous across facets and segments).
  float u = vPaintedData.w;
  // Irregular course heights: a warped vertical coordinate gives thin and thick courses.
  float yc = p.y / uCourseM;
  // Kept well below 1/1.7: a stronger warp squeezes courses into dark horizontal bands.
  yc += 0.25 * sin(yc * 1.7);
  float course = floor(yc);
  float rowJitter = paintedHash12(vec2(course, 3.7));
  float stoneW = uCourseM * (1.2 + 1.0 * rowJitter);
  // Monotonic warp of the course coordinate: stone lengths vary ~0.4–1.6 × within a course.
  float su0 = u / stoneW + rowJitter * 0.5 + mod(course, 2.0) * 0.5;
  float su = su0 + 0.3 * sin(su0 * 2.1 + course * 3.7);
  float stoneId = floor(su);
  vec2 f = vec2(fract(su), fract(yc));
  float edgeX = min(f.x, 1.0 - f.x) * stoneW;
  float edgeY = min(f.y, 1.0 - f.y) * uCourseM;
  // Irregular joints: width wanders along each joint so stones read hand-laid, not brick.
  float jointW = 0.012 + 0.012 * paintedValueNoise(vec2(u * 2.3, p.y * 2.9));
  float stoneMask = smoothstep(jointW, jointW + 0.03, min(edgeX, edgeY));
  float horizontal = step(0.75, abs(n.y));
  stoneMask = mix(stoneMask, 1.0, horizontal);

  float tone = paintedHash12(vec2(stoneId, course));
  vec3 stoneC = mix(uStoneBase, uStoneLit, 0.3 + 0.6 * tone);
  stoneC = max(paintedHueShift(stoneC, (paintedHash12(vec2(course, stoneId + 9.1)) - 0.5) * 0.04), 0.0);
  // Rounded stone faces: darker towards the joints.
  stoneC *= 0.88 + 0.12 * smoothstep(0.0, 0.25, min(edgeX, edgeY));
  // Catch light on the upper arris of each stone.
  stoneC *= 1.0 + 0.1 * smoothstep(0.75, 0.95, f.y) * (1.0 - horizontal);
  vec3 col = mix(uMortar, stoneC, stoneMask);

  float nLarge = paintedFbm(vec2(u, p.y) / 6.0);
  float mossLine = 1.2 + 1.6 * nLarge;
  float moss = (1.0 - smoothstep(mossLine * 0.4, mossLine, h)) * smoothstep(0.35, 0.65, paintedFbm(vec2(u, p.y) * 0.9));
  col = mix(col, uMoss, moss * 0.8);

  float streakNoise = paintedValueNoise(vec2(u * 1.3, 0.0)) * paintedValueNoise(vec2(u * 0.37, 5.0));
  float fromTop = smoothstep(uWallHeightM * 0.35, uWallHeightM, h);
  col *= 1.0 - 0.28 * smoothstep(0.25, 0.55, streakNoise) * fromTop * (1.0 - horizontal);
  col *= mix(0.78, 1.04, smoothstep(0.0, uWallHeightM, h));
  col *= 0.88 + 0.24 * nLarge;
  diffuseColor.rgb = col * vColor.rgb;
}
`;

/** Default course height of castle masonry (m). */
const CASTLE_COURSE_M = 0.7;

export function createStoneMaterial(wallHeightM: number, courseM = CASTLE_COURSE_M): PaintedMaterial {
  return createPaintedMaterial({
    name: 'CastleStone',
    worldNormal: true,
    vertexData: true,
    vertexColors: true,
    wrap: 0.4,
    customAlbedo: {
      key: 'stone-v1',
      pars: STONE_PARS,
      body: STONE_ALBEDO,
      uniforms: {
        uStoneLit: { value: new Color(PALETTE.stone.lit) },
        uStoneBase: { value: new Color(PALETTE.stone.base) },
        uMortar: { value: new Color(PALETTE.mortar) },
        uMoss: { value: new Color(PALETTE.moss.base) },
        uCourseM: { value: courseM },
        uWallHeightM: { value: wallHeightM },
      },
    },
  });
}
