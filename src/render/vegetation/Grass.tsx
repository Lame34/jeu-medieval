/**
 * GPU grass (brief §7): single-triangle blades generated in the vertex shader, only within a
 * radius around the camera focus, fading out towards the edge. Blades are anchored to a world
 * grid (no swimming when the camera pans), placed on the shared height texture, masked by the
 * splat (no grass on roads, fields, water or under walls; sparse in the woods) and bent by wind.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, Vector2, type Texture } from 'three';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { PALETTE } from '../materials/palette.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import type { QualityPreset } from '../quality/presets.ts';

const BLADE_VERTS = 3;

const GRASS_PARS = /* glsl */ `
attribute vec3 aBlade;
uniform sampler2D uGrassHeights;
uniform vec2 uGrassHeightsSize;
uniform sampler2D uGrassSplat;
uniform vec2 uGrassMapSize;
uniform vec2 uGrassOrigin;
uniform float uGrassRadius;
uniform float uGrassSpacing;
uniform vec3 uGrassLushBase;
uniform vec3 uGrassLushTip;
uniform vec3 uGrassDryBase;
uniform vec3 uGrassDryTip;
float grassHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const GRASS_BODY = /* glsl */ `
{
  vec2 cell = floor((uGrassOrigin + aBlade.xz) / uGrassSpacing + 0.5);
  float h1 = grassHash(cell);
  float h2 = grassHash(cell + 17.31);
  float h3 = grassHash(cell + 41.07);
  vec2 world = cell * uGrassSpacing + (vec2(h1, h2) - 0.5) * uGrassSpacing * 0.95;
  float dist = length(world - uFocus.xz);
  float fade = 1.0 - smoothstep(uGrassRadius * 0.6, uGrassRadius, dist);
  vec4 splat = texture2D(uGrassSplat, world / uGrassMapSize);
  float allowed = (1.0 - smoothstep(0.12, 0.38, splat.r + splat.g + splat.b)) * (1.0 - 0.75 * splat.a);
  // The meadow runs on 25 m past the map edge, fading, so the seam never reads.
  vec2 beyond = max(max(vec2(0.5) - world, world - (uGrassMapSize - 0.5)), 0.0);
  allowed *= 1.0 - smoothstep(10.0, 25.0, length(beyond));
  float clump = smoothstep(0.25, 0.75, paintedValueNoise(world * 0.35));
  float scale = fade * allowed * mix(0.55, 1.0, clump);
  float ground = texture2D(uGrassHeights, (world + 0.5) / uGrassHeightsSize).r;
  // Flowering blades grow in patches: shorter, wider, butter or mauve heads read as dots.
  float flower = step(0.985, grassHash(cell + 73.7)) * step(0.5, smoothstep(0.6, 0.8, paintedFbm(world / 9.0 + 3.0)));
  float height = mix(0.2, 0.45, h3) * mix(0.7, 1.15, clump) * scale * mix(1.0, 0.6, flower);
  // Never thinner than ~1 px at the camera distance (no shimmering specks).
  float camD = distance(vec3(world.x, ground, world.y), cameraPosition);
  float width = max(0.065, 0.0011 * camD) * scale * mix(1.0, 1.5, flower);
  float angle = h1 * 6.2831853;
  vec2 side = vec2(cos(angle), sin(angle)) * width;
  vec3 p;
  if (aBlade.y < 0.5) {
    p = vec3(world.x - side.x, ground - 0.02, world.y - side.y);
  } else if (aBlade.y < 1.5) {
    p = vec3(world.x + side.x, ground - 0.02, world.y + side.y);
  } else {
    float phase = dot(world, vec2(0.13, 0.09));
    float gust = sin(uTime * 1.6 + phase) * 0.5 + 0.5 + 0.35 * sin(uTime * 3.1 + phase * 2.3);
    // Constant lean downwind (blades read as oriented brush strokes) + gusts + jitter.
    vec2 lean = (vec2(h2, h1) - 0.5) * 0.45 * height + uWindDir * (0.25 + uWindStrength * gust * 0.35) * height;
    p = vec3(world.x + lean.x, ground + height, world.y + lean.y);
  }
  transformed = p;
  // Same large-scale tones as the painted ground (dry patches, darker clover).
  float dry = smoothstep(0.42, 0.8, paintedFbm(world / 26.0)) * 0.85;
  float clover = smoothstep(0.55, 0.75, paintedFbm(world / 11.0 + 31.0)) * (1.0 - dry);
  vec3 base = mix(uGrassLushBase, uGrassDryBase, dry);
  vec3 tip = mix(uGrassLushTip, uGrassDryTip, dry);
  vec3 c = (aBlade.y < 1.5 ? base : tip) * mix(0.86, 1.1, h2) * (1.0 - 0.14 * clover);
  if (aBlade.y > 1.5 && flower > 0.5) c = h3 > 0.5 ? vec3(0.81, 0.64, 0.19) : vec3(0.46, 0.37, 0.55);
  #ifdef USE_COLOR
  vColor = vec4(c, 1.0);
  #endif
}
`;

function bladeGeometry(radiusM: number, spacingM: number): BufferGeometry {
  const perSide = Math.ceil((2 * radiusM) / spacingM);
  const count = perSide * perSide;
  const blade = new Float32Array(count * BLADE_VERTS * 3);
  const normals = new Float32Array(count * BLADE_VERTS * 3);
  const colors = new Float32Array(count * BLADE_VERTS * 3).fill(1);
  let v = 0;
  for (let j = 0; j < perSide; j++) {
    for (let i = 0; i < perSide; i++) {
      const x = -radiusM + (i + 0.5) * spacingM;
      const z = -radiusM + (j + 0.5) * spacingM;
      for (let k = 0; k < BLADE_VERTS; k++) {
        blade.set([x, k, z], v * 3);
        normals.set([0, 1, 0], v * 3);
        v++;
      }
    }
  }
  const g = new BufferGeometry();
  // `position` is required by three; the vertex shader replaces it entirely.
  g.setAttribute('position', new BufferAttribute(new Float32Array(count * BLADE_VERTS * 3), 3));
  g.setAttribute('aBlade', new BufferAttribute(blade, 3));
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

export function Grass({
  terrain,
  heights,
  splat,
  preset,
}: {
  readonly terrain: TerrainData;
  readonly heights: Texture;
  readonly splat: Texture;
  readonly preset: QualityPreset;
}) {
  const spacing = 1 / Math.sqrt(preset.grassDensityPerM2);
  const built = useMemo(() => {
    const origin = new Vector2();
    const lushBase = new Color(PALETTE.grassLush.base);
    const material = createPaintedMaterial({
      name: 'Grass',
      vertexColors: true,
      side: DoubleSide,
      keepNormalOnBackFaces: true,
      heightM: 1,
      gradientBase: 1,
      gradientTop: 1,
      gradientSaturation: 0,
      groundAO: 0,
      customVertex: {
        key: 'grass-v1',
        pars: GRASS_PARS,
        body: GRASS_BODY,
        uniforms: {
          uGrassHeights: { value: heights },
          uGrassHeightsSize: { value: new Vector2(terrain.width + 1, terrain.depth + 1) },
          uGrassSplat: { value: splat },
          uGrassMapSize: { value: new Vector2(terrain.width * terrain.cellSize, terrain.depth * terrain.cellSize) },
          uGrassOrigin: { value: origin },
          uGrassRadius: { value: preset.grassRadiusM },
          uGrassSpacing: { value: spacing },
          // Blade roots match the painted ground so the carpet has no dark seams.
          uGrassLushBase: { value: lushBase.clone().lerp(new Color(PALETTE.grassLush.lit), 0.45) },
          // Blades are the ground's own colour, tips at most +10 % value (no "shark teeth").
          uGrassLushTip: { value: lushBase.clone().lerp(new Color(PALETTE.grassLush.lit), 0.45).multiplyScalar(1.1) },
          uGrassDryBase: { value: new Color(PALETTE.grassDry.base).lerp(new Color(PALETTE.grassDry.lit), 0.45) },
          uGrassDryTip: { value: new Color(PALETTE.grassDry.base).lerp(new Color(PALETTE.grassDry.lit), 0.45).multiplyScalar(1.1) },
        },
      },
    });
    const mesh = new Mesh(bladeGeometry(preset.grassRadiusM, spacing), material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.name = 'Grass';
    return { mesh, origin };
  }, [terrain, heights, splat, preset, spacing]);

  useEffect(
    () => () => {
      built.mesh.geometry.dispose();
      (built.mesh.material as { dispose(): void }).dispose();
    },
    [built],
  );

  useFrame(() => {
    const focus = paintedGlobals.uFocus.value;
    built.origin.set(Math.round(focus.x / spacing) * spacing, Math.round(focus.z / spacing) * spacing);
  });

  return <primitive object={built.mesh} />;
}
