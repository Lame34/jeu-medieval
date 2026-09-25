/**
 * Painted sky dome: zenith→horizon gradient warmed towards the sun, sun glow, soft fBm clouds
 * and three layers of distant mountain silhouettes (bluer and paler with distance). The dome
 * follows the camera, so the horizon is always a painted backdrop, never the map edge.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { PAINTED_GLOBALS_PARS, PAINTED_NOISE } from '../materials/painted-chunks.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';

const SKY_RADIUS_M = 4000;
const SKY_SEGMENTS = 48;

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
  float towardSun = dot(dirXZ, sunXZ) * 0.5 + 0.5;

  vec3 horizon = mix(uHorizonAway, uHorizonSun, pow(towardSun, 2.2));
  float up = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(horizon, uSkyZenith, pow(smoothstep(0.0, 0.55, up), 0.75));

  float cosSun = dot(d, uSunDir);
  sky += uSunColor * (pow(max(cosSun, 0.0), 180.0) * 0.9 + pow(max(cosSun, 0.0), 8.0) * 0.22);
  sky = mix(sky, uSunColor * 1.6 + 0.4, smoothstep(0.99955, 0.99985, cosSun));

  // Painted clouds on a virtual plane: soft-edged, lit on the sun side, drifting slowly.
  if (d.y > 0.0) {
    vec2 cuv = d.xz / (d.y + 0.12) * 0.9 + uWindDir * uTime * 0.004;
    float c = paintedFbm(cuv * 1.3);
    c = smoothstep(0.52, 0.78, c + 0.12 * paintedValueNoise(cuv * 6.0));
    float fade = smoothstep(0.02, 0.25, d.y);
    vec3 cloudLit = mix(horizon * 1.05, vec3(1.0, 0.97, 0.92), 0.55) + uSunColor * 0.25 * pow(towardSun, 3.0);
    vec3 cloudShade = mix(uSkyZenith, uHorizonAway, 0.5) * 0.92;
    vec3 cloud = mix(cloudShade, cloudLit, smoothstep(0.3, 0.9, c + 0.25 * towardSun));
    sky = mix(sky, cloud, c * fade * 0.8);
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
  const mesh = useMemo(() => {
    const material = new ShaderMaterial({
      uniforms: { ...paintedGlobals },
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
    return m;
  }, []);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    },
    [mesh],
  );

  useFrame(({ camera }) => {
    mesh.position.copy(camera.position);
  });

  return <primitive object={mesh} />;
}
