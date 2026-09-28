/**
 * Painted sky dome: zenith→horizon gradient warmed towards the sun, sun glow, painted cloud
 * banks and three layers of distant mountain silhouettes (bluer and paler with distance). The
 * dome follows the camera, so the horizon is always a painted backdrop, never the map edge.
 * Clouds are painted once at load into a seamless panorama (azimuth × elevation): the
 * tactical camera mostly sees the band just above the horizon, so that is where they gather.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BackSide, DataTexture, LinearFilter, Mesh, RGBAFormat, RepeatWrapping, ClampToEdgeWrapping, ShaderMaterial, SphereGeometry, UnsignedByteType } from 'three';
import { smoothstep } from '../../core/math/scalar.ts';
import { createSimplex, fbm, type FbmOptions } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';
import { PAINTED_GLOBALS_PARS, PAINTED_NOISE } from '../materials/painted-chunks.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';

const SKY_RADIUS_M = 4000;
const SKY_SEGMENTS = 48;
const CLOUD_W = 1024;
const CLOUD_H = 256;
/** Elevation (d.y) covered by the panorama; clouds above it fade out. */
const CLOUD_TOP = 0.5;
const CLOUD_FBM: FbmOptions = { octaves: 5, lacunarity: 2.1, gain: 0.5, frequency: 1 / 70 };
/** Vertical squash: cloud banks are wider than tall. */
const CLOUD_SQUASH = 2.6;

/** Seamless cloud panorama: R = density, G = light (top-lit, shaded undersides). */
function paintClouds(): DataTexture {
  const noise = createSimplex(Rng.create('sky-clouds'));
  const density = new Float32Array(CLOUD_W * CLOUD_H);
  for (let j = 0; j < CLOUD_H; j++) {
    const v = j / (CLOUD_H - 1);
    // Banks gather just above the mountains and thin out towards the zenith.
    const coverage = smoothstep(0.02, 0.1, v) * (1 - smoothstep(0.3, 0.95, v));
    for (let i = 0; i < CLOUD_W; i++) {
      // Wrap blend across the azimuth seam.
      const w = i / CLOUD_W;
      const y = j * CLOUD_SQUASH;
      const n = fbm(noise, i, y, CLOUD_FBM) * (1 - w) + fbm(noise, i - CLOUD_W, y, CLOUD_FBM) * w;
      density[j * CLOUD_W + i] = smoothstep(0.12, 0.42, n * 0.5 + (coverage - 0.55) * 0.55);
    }
  }
  const bytes = new Uint8Array(CLOUD_W * CLOUD_H * 4);
  const at = (i: number, j: number) => density[Math.min(CLOUD_H - 1, Math.max(0, j)) * CLOUD_W + i] as number;
  for (let j = 0; j < CLOUD_H; j++) {
    for (let i = 0; i < CLOUD_W; i++) {
      const d = at(i, j);
      const light = Math.min(1, Math.max(0, 0.62 + 2.2 * (d - at(i, j + 4)) - 1.4 * (d - at(i, j - 4))));
      const k = (j * CLOUD_W + i) * 4;
      bytes[k] = Math.round(d * 255);
      bytes[k + 1] = Math.round(light * 255);
      bytes[k + 3] = 255;
    }
  }
  const texture = new DataTexture(bytes, CLOUD_W, CLOUD_H, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  // No mip-maps: the atan() seam would pick the smallest level along one column.
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // at the far plane
}
`;

const fragmentShader = /* glsl */ `
${PAINTED_GLOBALS_PARS}
${PAINTED_NOISE}
uniform sampler2D uClouds;
varying vec3 vDir;

// Silhouette height (in "d.y" units) of a mountain layer around the horizon.
float ridge(vec2 dirXZ, float scale, float seed, float base, float amp) {
  vec2 p = dirXZ * scale + seed;
  float n = paintedFbm(p);
  float peaks = pow(paintedValueNoise(p * 2.7 + 3.1), 2.0);
  return base + amp * (0.65 * n + 0.35 * peaks);
}

void main() {
  vec3 d = normalize(vDir);
  vec2 dirXZ = normalize(d.xz + vec2(1e-5));
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-5));
  // Clamped: exactly opposite the sun, rounding can dip below 0 and pow() then returns NaN.
  float towardSun = clamp(dot(dirXZ, sunXZ) * 0.5 + 0.5, 0.0, 1.0);

  vec3 horizon = mix(uHorizonAway, uHorizonSun, pow(towardSun, 2.2));
  float up = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(horizon, uSkyZenith, pow(smoothstep(0.0, 0.55, up), 0.75));

  float cosSun = dot(d, uSunDir);
  sky += uSunColor * (pow(max(cosSun, 0.0), 180.0) * 0.9 + pow(max(cosSun, 0.0), 8.0) * 0.22);
  sky = mix(sky, uSunColor * 1.6 + 0.4, smoothstep(0.99955, 0.99985, cosSun));

  // Painted cloud banks from the panorama, drifting slowly; lit on top and on the sun side.
  if (d.y > 0.0) {
    float az = atan(d.z, d.x) / 6.2831853 + 0.5 + uTime * 0.0004;
    vec4 cl = texture2D(uClouds, vec2(az, d.y / ${CLOUD_TOP.toFixed(2)}));
    float c = cl.r * (1.0 - smoothstep(${(CLOUD_TOP * 0.85).toFixed(2)}, ${CLOUD_TOP.toFixed(2)}, d.y));
    vec3 cloudLit = mix(horizon * 1.05, vec3(1.0, 0.97, 0.92), 0.55) + uSunColor * (0.08 + 0.22 * pow(towardSun, 3.0));
    vec3 cloudShade = mix(mix(uSkyZenith, uHorizonAway, 0.55) * 0.9, vec3(0.34, 0.33, 0.47), 0.3);
    vec3 cloud = mix(cloudShade, cloudLit, clamp(cl.g + 0.2 * towardSun, 0.0, 1.0));
    sky = mix(sky, cloud, c * 0.85);
  }

  // Distant mountains: three layers, farthest palest (aerial perspective).
  vec3 hazeFar = mix(horizon, uFogAway, 0.35);
  float h1 = ridge(dirXZ, 3.0, 11.0, 0.035, 0.07);
  float h2 = ridge(dirXZ, 4.6, 37.0, 0.018, 0.05);
  float h3 = ridge(dirXZ, 6.5, 71.0, 0.004, 0.028);
  vec3 m1 = mix(hazeFar, uSkyZenith, 0.18);
  vec3 m2 = mix(hazeFar, uSkyZenith * 0.8 + vec3(0.02, 0.03, 0.02), 0.32);
  vec3 m3 = mix(hazeFar, vec3(0.22, 0.27, 0.24), 0.30);
  float edge = 0.0015;
  sky = mix(sky, m1, smoothstep(h1 + edge, h1 - edge, d.y));
  sky = mix(sky, m2, smoothstep(h2 + edge, h2 - edge, d.y));
  sky = mix(sky, m3, smoothstep(h3 + edge, h3 - edge, d.y));
  // Below the horizon (hidden by the outer landscape ring, but never black).
  sky = mix(sky, mix(uFogAway, uFogSun, pow(towardSun, 3.0)), smoothstep(0.0, -0.05, d.y));

  gl_FragColor = vec4(sky, 1.0);
}
`;

export function Sky() {
  const built = useMemo(() => {
    const clouds = paintClouds();
    const material = new ShaderMaterial({
      uniforms: { ...paintedGlobals, uClouds: { value: clouds } },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    const m = new Mesh(new SphereGeometry(SKY_RADIUS_M, SKY_SEGMENTS, SKY_SEGMENTS / 2), material);
    m.frustumCulled = false;
    m.renderOrder = -1000;
    m.name = 'Sky';
    return { m, clouds };
  }, []);

  useEffect(
    () => () => {
      built.m.geometry.dispose();
      (built.m.material as ShaderMaterial).dispose();
      built.clouds.dispose();
    },
    [built],
  );

  useFrame(({ camera }) => {
    built.m.position.copy(camera.position);
  });

  return <primitive object={built.m} />;
}
