/**
 * Stylised water (brief §5.5): no real-time reflection. Depth-based colour from the terrain
 * height texture, bank foam, painted sky reflection (fresnel), flowing ripples along the
 * river tangent, sun glints, and the shared atmospheric fog. Moats are darker and still.
 */
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, type Texture, type Vector2 } from 'three';
import type { Vec2 } from '../../core/math/vec2.ts';
import { extendedRiver } from './river-extension.ts';
import type { WaterBody } from '../../core/worldgen/types.ts';
import { PAINTED_FOG_FN, PAINTED_GLOBALS_PARS, PAINTED_NOISE } from '../materials/painted-chunks.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { PALETTE } from '../materials/palette.ts';

/** Ribbon half-width beyond the nominal bank (m): the terrain clips the excess. */
const BANK_OVERLAP_M = 4;
const RIVER_FLOW_SPEED = 0.35;

function buildRibbon(centerline: readonly Vec2[], halfWidth: number, level: number): BufferGeometry {
  const n = centerline.length;
  const positions = new Float32Array(n * 2 * 3);
  const flow = new Float32Array(n * 2 * 3);
  const sides = new Float32Array(n * 2);
  let along = 0;
  for (let i = 0; i < n; i++) {
    const p = centerline[i] as Vec2;
    const prev = centerline[Math.max(0, i - 1)] as Vec2;
    const next = centerline[Math.min(n - 1, i + 1)] as Vec2;
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    if (i > 0) along += Math.hypot(p.x - prev.x, p.z - prev.z);
    for (let side = 0; side < 2; side++) {
      const s = side === 0 ? -1 : 1;
      const v = i * 2 + side;
      positions[v * 3] = p.x - tz * halfWidth * s;
      positions[v * 3 + 1] = level;
      positions[v * 3 + 2] = p.z + tx * halfWidth * s;
      flow[v * 3] = tx;
      flow[v * 3 + 1] = tz;
      flow[v * 3 + 2] = along;
      sides[v] = s;
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    // Counter-clockwise seen from above (+y): the surface faces the sky.
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setAttribute('aFlow', new BufferAttribute(flow, 3));
  g.setAttribute('aSide', new BufferAttribute(sides, 1));
  g.setIndex(indices);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const vertexShader = /* glsl */ `
attribute vec3 aFlow;
attribute float aSide;
varying vec3 vWorldPos;
varying vec3 vFlow;
varying float vSide;
void main() {
  vSide = aSide;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vFlow = aFlow;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${PAINTED_GLOBALS_PARS}
${PAINTED_NOISE}
${PAINTED_FOG_FN}
uniform sampler2D uHeights;
uniform vec2 uHeightsSize;
uniform float uLevel;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uFlowSpeed;
uniform float uStill;
varying vec3 vWorldPos;
varying vec3 vFlow;
varying float vSide;

void main() {
  vec2 huv = (vWorldPos.xz + 0.5) / uHeightsSize;
  float ground = texture2D(uHeights, huv).r;
  vec2 inMap = step(vec2(0.0), vWorldPos.xz) * step(vWorldPos.xz, uHeightsSize - 1.0);
  // Beyond the map (no height texture there) the bed is a parabola: deep centre, shallow banks.
  float depth = inMap.x * inMap.y > 0.5 ? uLevel - ground : 1.6 * (1.0 - vSide * vSide);
  if (depth < -0.02) discard;

  vec2 tangent = normalize(vFlow.xy + vec2(1e-5));
  vec2 normalDir = vec2(-tangent.y, tangent.x);
  float along = vFlow.z;
  float across = dot(vWorldPos.xz, normalDir);
  float t = uTime * uFlowSpeed * (1.0 - uStill);
  vec2 flowUv = vec2(along - t * 3.0, across);

  float r1 = paintedFbm(flowUv * vec2(0.35, 0.9));
  float r2 = paintedValueNoise(flowUv * vec2(1.4, 3.2) + 5.0);
  float ripple = mix(r1, r2, 0.35);

  // The water body is lit like the scene (it would glow at dusk otherwise); reflections are not.
  // Running water: scene light mostly desaturated (the blue morning light turned the river royal
  // blue). Moats keep their green (desaturated, they read as a concrete band).
  vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 0.7, depth)) * mix(uSceneLight, vec3(dot(uSceneLight, vec3(1.0 / 3.0))), 0.6 * (1.0 - uStill));
  vec3 view = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-5));
  float towardSun = dot(normalize(-view.xz + vec2(1e-5)), sunXZ) * 0.5 + 0.5;
  vec3 skyRefl = mix(mix(uHorizonAway, uHorizonSun, towardSun), uSkyZenith, 0.35);
  // Running water reflects a teal sky, not a glacier blue (review v15).
  skyRefl = mix(skyRefl, uShallow, 0.4 * (1.0 - uStill));
  // Still water (moats) mirrors the sky much more than running water: it must read as water.
  float farCalm = mix(1.0 - 0.6 * smoothstep(30.0, 90.0, distance(cameraPosition, vWorldPos)), 1.0, uStill);
  float reflection = uStill * 0.12 + fresnel * mix(0.45, 0.7, uStill) + (ripple - 0.5) * mix(0.18, 0.08, uStill) * farCalm;
  col = mix(col, skyRefl * 0.9, clamp(reflection, 0.0, mix(0.1, 0.5, uStill)));

  // Painted light streaks along the current.
  float streak = smoothstep(0.72, 0.92, paintedValueNoise(flowUv * vec2(0.25, 2.8)));
  col += uSunColor * streak * 0.035 * (1.0 - uStill);

  // Sun glints.
  vec3 n = normalize(vec3((ripple - 0.5) * 0.2, 1.0, (r2 - 0.5) * 0.2));
  float spec = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 300.0);
  col += uSunColor * spec * 0.1;

  // Bank foam: thin, broken, drifting.
  float foamBand = 1.0 - smoothstep(0.02, 0.14, depth);
  float foamNoise = smoothstep(0.35, 0.75, paintedValueNoise(flowUv * vec2(0.6, 2.2) + 11.0));
  col = mix(col, uFoam * uSceneLight, foamBand * foamNoise * 0.6 * (1.0 - uStill * 0.6));

  float alpha = smoothstep(-0.02, 0.22, depth);
  col = paintedSaturationCeiling(col, mix(0.4, 0.52, uStill));
  col = paintedApplyFog(col, vWorldPos);
  gl_FragColor = vec4(col, alpha * mix(0.92, 0.97, smoothstep(0.2, 1.5, depth)));
}
`;

export function Water({ bodies, heights, heightsSize }: { readonly bodies: readonly WaterBody[]; readonly heights: Texture; readonly heightsSize: Vector2 }) {
  const meshes = useMemo(
    () =>
      bodies.map((body) => {
        const still = body.kind === 'moat' ? 1 : 0;
        const material = new ShaderMaterial({
          uniforms: {
            ...paintedGlobals,
            uHeights: { value: heights },
            uHeightsSize: { value: heightsSize },
            uLevel: { value: body.levelM },
            uShallow: { value: new Color(still ? PALETTE.water.moatTop : PALETTE.water.shallow) },
            uDeep: { value: new Color(still ? PALETTE.water.moatDeep : PALETTE.water.deep) },
            uFoam: { value: new Color(PALETTE.water.foam) },
            uFlowSpeed: { value: RIVER_FLOW_SPEED },
            uStill: { value: still },
          },
          vertexShader,
          fragmentShader,
          transparent: true,
          depthWrite: false,
        });
        const line = body.kind === 'river' ? extendedRiver(body.centerline) : body.centerline;
        const mesh = new Mesh(buildRibbon(line, body.widthM / 2 + BANK_OVERLAP_M, body.levelM), material);
        mesh.name = `Water:${body.id}`;
        mesh.renderOrder = 10;
        return mesh;
      }),
    [bodies, heights, heightsSize],
  );

  useEffect(
    () => () => {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      }
    },
    [meshes],
  );

  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}
