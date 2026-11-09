/**
 * Stylised water (brief §5.5): depth-based colour from the terrain height texture, bank foam,
 * painted sky reflection (fresnel), flowing ripples along the river tangent, sun glints, and the
 * shared atmospheric fog. Moats are darker and still; at the high preset their still water
 * mirrors the castle, the trees and the sky (reflection.ts, ADR-055), the running river keeps its
 * painted shimmer.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, Frustum, Matrix4, Mesh, ShaderMaterial, type PerspectiveCamera, type Texture, type Vector2 } from 'three';
import type { Vec2 } from '../../core/math/vec2.ts';
import { extendedRiver } from './river-extension.ts';
import type { WaterBody } from '../../core/worldgen/types.ts';
import { PAINTED_FOG_FN, PAINTED_GLOBALS_PARS, PAINTED_NOISE } from '../materials/painted-chunks.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { PALETTE } from '../materials/palette.ts';
import { keepOutOfReflections, PlanarReflection } from './reflection.ts';
import { useSceneConditions } from '../../state/scene-conditions.ts';

/** Ribbon half-width beyond the nominal bank (m): the terrain clips the excess. */
const BANK_OVERLAP_M = 4;
const RIVER_FLOW_SPEED = 0.35;
/**
 * The mirror: how far the wind's ripples shift it (texture units), its share of the moat's colour
 * from straight above to grazing, and how much it takes the water's green and loses light, so the
 * moat still reads as dark water and as an obstacle (review J4). Redrawn every frame while the view
 * moves, every MIRROR_EVERY frames otherwise.
 */
const MIRROR_STIR = 0.008;
const MIRROR_SHARE: readonly [number, number] = [0.3, 0.85];
const MIRROR_TINT = 0.45;
const MIRROR_LIGHT = 0.72;
const MIRROR_EVERY = 2;
/**
 * Under the rain the drops break the mirror (its stir this many times stronger, its share of the
 * colour cut to this) and ring the water, in two scattered layers of drops: drops per metre in the
 * first (the second is finer by RAIN_FINE_LAYER and turned), how fast a ring opens, how far it
 * reaches (share of a cell, drawn per drop), how far from the camera the rings fade (m), their light.
 */
const RAIN_STIR = 3.5;
const RAIN_MIRROR = 0.55;
const RAIN_RINGS_PER_M = 1.2;
const RAIN_FINE_LAYER = 1.6;
const RAIN_RING_RATE = 0.9;
const RAIN_RING_REACH: readonly [number, number] = [0.18, 0.4];
const RAIN_RINGS_FADE_M: readonly [number, number] = [30, 75];
const RAIN_RING_LIGHT = 0.15;
/** A ring's line (in cells), and at least this many pixels wide: thinner far off, it would flicker. */
const RAIN_RING_WIDTH = 0.05;
const RAIN_RING_MIN_PX = 1.5;

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
#ifdef WATER_MIRROR
uniform mat4 uMirrorMatrix;
varying vec4 vMirrorUv;
#endif
void main() {
  vSide = aSide;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vFlow = aFlow;
  #ifdef WATER_MIRROR
  vMirrorUv = uMirrorMatrix * wp;
  #endif
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
uniform float uRainy;
uniform vec3 uDuckweed;
varying vec3 vWorldPos;
varying vec3 vFlow;
varying float vSide;
#ifdef WATER_MIRROR
uniform sampler2D uMirror;
varying vec4 vMirrorUv;
#endif

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
  // At dusk (low sun) the river keeps more of the warm light: peach-lilac, not asphalt.
  float sunHigh = smoothstep(0.1, 0.45, uSunDir.y);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 0.7, depth)) * mix(uSceneLight, vec3(dot(uSceneLight, vec3(1.0 / 3.0))), mix(0.25, 0.6, sunHigh) * (1.0 - uStill));
  vec3 view = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-5));
  float towardSun = dot(normalize(-view.xz + vec2(1e-5)), sunXZ) * 0.5 + 0.5;
  vec3 skyRefl = mix(mix(uHorizonAway, uHorizonSun, towardSun), uSkyZenith, 0.35);
  // Running water reflects a teal sky, not a glacier blue (review v15).
  skyRefl = mix(skyRefl, uShallow, mix(0.25, 0.4, sunHigh) * (1.0 - uStill));
  // Still water (moats): a dark mirror, darker than the berm around it, so it reads as water and
  // as an obstacle (review J4: a bright sky reflection made it a concrete road).
  float farCalm = mix(1.0 - 0.6 * smoothstep(30.0, 90.0, distance(cameraPosition, vWorldPos)), 1.0, uStill);
  #ifdef WATER_MIRROR
  // The still water mirrors the castle, the trees and the sky, stirred by the wind's ripples,
  // in the water's own green and a little darker than the scene above it.
  float stirSpeed = mix(1.0, ${RAIN_STIR.toFixed(2)}, uRainy);
  vec2 stir = vec2(paintedValueNoise(vWorldPos.xz * 0.9 + uTime * 0.21 * stirSpeed), paintedValueNoise(vWorldPos.xz * 0.9 + 17.0 - uTime * 0.17 * stirSpeed)) - 0.5;
  vec3 mirrored = texture2D(uMirror, vMirrorUv.xy / vMirrorUv.w + stir * ${MIRROR_STIR.toFixed(4)} * stirSpeed).rgb;
  vec3 waterHue = uShallow / max(max(uShallow.r, max(uShallow.g, uShallow.b)), 1e-3);
  mirrored *= mix(vec3(1.0), waterHue, ${MIRROR_TINT.toFixed(2)}) * ${MIRROR_LIGHT.toFixed(2)};
  col = mix(col, mirrored, mix(${MIRROR_SHARE[0].toFixed(2)}, ${MIRROR_SHARE[1].toFixed(2)}, fresnel) * mix(1.0, ${RAIN_MIRROR.toFixed(2)}, uRainy));
  #else
  float reflection = uStill * 0.03 + fresnel * mix(0.45, 0.35, uStill) + (ripple - 0.5) * mix(0.18, 0.08, uStill) * farCalm;
  col = mix(col, skyRefl * mix(0.9, 0.72, uStill), clamp(reflection, 0.0, mix(mix(0.22, 0.1, sunHigh), 0.25, uStill)));
  #endif
  // Duckweed in the moat's shallows, in broken patches.
  float weed = smoothstep(0.48, 0.72, paintedValueNoise(vWorldPos.xz * 0.35 + 3.0)) * (1.0 - smoothstep(0.2, 0.4, depth)) * uStill;
  col = mix(col, uDuckweed * uSceneLight, weed * 0.5);

  // Painted light streaks along the current.
  float streak = smoothstep(0.72, 0.92, paintedValueNoise(flowUv * vec2(0.25, 2.8)));
  col += uSunColor * streak * 0.035 * (1.0 - uStill);

  // Sun (or moon) glints: on the current's ripples, or on the still mirror's slow swell, smooth and
  // turned off the axes (a value-noise grid would show in so sharp a highlight).
  #ifdef WATER_MIRROR
  vec2 swellP = mat2(0.8, -0.6, 0.6, 0.8) * vWorldPos.xz * 0.35;
  vec2 calm = vec2(paintedFbm(swellP + uTime * 0.05), paintedFbm(swellP + 9.0 - uTime * 0.04)) - 0.5;
  vec3 n = normalize(vec3(calm.x * 0.12, 1.0, calm.y * 0.12));
  #else
  vec3 n = normalize(vec3((ripple - 0.5) * 0.2, 1.0, (r2 - 0.5) * 0.2));
  #endif
  float spec = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 300.0);
  col += uSunColor * spec * 0.1;

  // Raindrops ring the water: two scattered layers of drops (the second finer and turned, so no
  // grid shows), each drop at its own moment and reach, its ring opening and fading.
  // A pixel's size on the water (m), taken here: derivatives are undefined in a branch or a loop.
  float pixelM = length(fwidth(vWorldPos.xz));
  if (uRainy > 0.0) {
    float rings = 0.0;
    for (int layer = 0; layer < 2; layer++) {
      float perM = layer == 0 ? ${RAIN_RINGS_PER_M.toFixed(2)} : ${(RAIN_RINGS_PER_M * RAIN_FINE_LAYER).toFixed(2)};
      vec2 q = layer == 0 ? vWorldPos.xz * ${RAIN_RINGS_PER_M.toFixed(2)} : (mat2(0.87, -0.5, 0.5, 0.87) * vWorldPos.xz + 13.7) * ${(RAIN_RINGS_PER_M * RAIN_FINE_LAYER).toFixed(2)};
      vec2 cell = floor(q) + float(layer) * 41.0;
      float age = fract(uTime * ${RAIN_RING_RATE.toFixed(2)} + paintedHash12(cell));
      vec2 drop = vec2(paintedHash12(cell + 3.1), paintedHash12(cell + 7.7)) * 0.5 + 0.25;
      float radius = length(fract(q) - drop);
      float reach = mix(${RAIN_RING_REACH[0].toFixed(2)}, ${RAIN_RING_REACH[1].toFixed(2)}, paintedHash12(cell + 11.3));
      float width = max(${RAIN_RING_WIDTH.toFixed(3)}, pixelM * perM * ${RAIN_RING_MIN_PX.toFixed(2)});
      rings += (1.0 - smoothstep(0.0, width, abs(radius - age * reach))) * (1.0 - age) * ${RAIN_RING_WIDTH.toFixed(3)} / width;
    }
    float near = 1.0 - smoothstep(${RAIN_RINGS_FADE_M[0].toFixed(1)}, ${RAIN_RINGS_FADE_M[1].toFixed(1)}, distance(cameraPosition, vWorldPos));
    col += uSceneLight * rings * near * ${RAIN_RING_LIGHT.toFixed(2)} * uRainy;
  }

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

export function Water({
  bodies,
  heights,
  heightsSize,
  mirrorScale,
}: {
  readonly bodies: readonly WaterBody[];
  readonly heights: Texture;
  readonly heightsSize: Vector2;
  /** The preset's waterMirror: the still water's mirror resolution, or null for painted reflections. */
  readonly mirrorScale: number | null;
}) {
  const built = useMemo(() => {
    const mirrors: { readonly mesh: Mesh; readonly reflection: PlanarReflection }[] = [];
    const meshes = bodies.map((body) => {
      const still = body.kind === 'moat' ? 1 : 0;
      const reflection = still && mirrorScale !== null ? new PlanarReflection(body.levelM, mirrorScale) : null;
      const material = new ShaderMaterial({
        defines: reflection ? { WATER_MIRROR: '' } : {},
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
          uRainy: { value: 0 },
          uDuckweed: { value: new Color(PALETTE.water.duckweed) },
          ...(reflection ? { uMirror: { value: reflection.target.texture }, uMirrorMatrix: { value: reflection.textureMatrix } } : {}),
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
      keepOutOfReflections(mesh);
      if (reflection) mirrors.push({ mesh, reflection });
      return mesh;
    });
    return { meshes, mirrors };
  }, [bodies, heights, heightsSize, mirrorScale]);

  useEffect(
    () => () => {
      for (const m of built.meshes) {
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      }
      for (const m of built.mirrors) m.reflection.dispose();
    },
    [built],
  );

  const weather = useSceneConditions((s) => s.weather);
  useEffect(() => {
    for (const m of built.meshes) (m.material as ShaderMaterial).uniforms['uRainy']!.value = weather === 'rain' ? 1 : 0;
  }, [built, weather]);

  const view = useRef({ frustum: new Frustum(), matrix: new Matrix4(), last: new Matrix4(), frame: 0 });
  // Before the frame's own render (the post chain renders at priority 1): the mirrors of the still
  // water in view, every frame while the view moves.
  useFrame(({ gl, scene, camera }) => {
    if (built.mirrors.length === 0) return;
    const v = view.current;
    const moved = !v.last.equals(camera.matrixWorld);
    if (moved) v.last.copy(camera.matrixWorld);
    else if (++v.frame % MIRROR_EVERY !== 0) return;
    v.frustum.setFromProjectionMatrix(v.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const m of built.mirrors) if (v.frustum.intersectsObject(m.mesh)) m.reflection.render(gl, scene, camera as PerspectiveCamera);
  });

  return (
    <>
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}
