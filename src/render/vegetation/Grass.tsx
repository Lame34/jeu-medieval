/**
 * GPU grass (brief §7, ADR-055): blades generated in the vertex shader on a carpet laid between the
 * camera and its focus, in rings of doubled spacing (and wider blades) farther out. Blades fade
 * with their distance from the camera, their colour drawing towards the ground's as they go, so
 * the meadow has no edge on screen; past that distance (a high, wide view) the carpet is not drawn.
 * Blades are anchored to a world grid (no swimming when the camera pans), placed on the shared
 * height texture, masked by the splat (no grass on roads, fields, water or under walls; sparse in
 * the woods) and bent by wind. Each blade is lit as the ground it grows on and coloured from the
 * ground's own tone (meadow-tone.ts), which it takes exactly as it fades. At the high preset each
 * blade is three triangles, curved and tapered. The blades write no depth (see GRASS_RENDER_ORDER).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, Vector2, Vector4, type Texture } from 'three';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';
import type { SeasonPalette } from '../materials/season-palette.ts';
import type { QualityPreset } from '../quality/presets.ts';
import { MEADOW_TONE_PARS, MEADOW_WRAP, meadowUniforms } from '../terrain/meadow-tone.ts';
import { keepOutOfReflections } from '../water/reflection.ts';

/** A straight blade: two base corners and the tip; a curved one: base, middle and tip (three triangles). */
const STRAIGHT_VERTS = 3;
const CURVED_VERTS = 5;
const CURVED_INDICES = [0, 1, 2, 1, 3, 2, 2, 3, 4] as const;
/** The carpet is laid this share of the way from the camera's ground point to its focus. */
const CARPET_TOWARDS_FOCUS = 0.5;
/** Blades at full size up to this share of the preset's fade distance. */
const FULL_SHARE = 0.55;
/**
 * A blade's colour: its root is the ground's tone in the shade of the others, its tip leans this far
 * towards the grass's lit tone; each blade's value and hue vary by these spreads; the wind's swell
 * lights the tips it bends by up to this share.
 */
const BLADE_ROOT_SHADE = 0.55;
const BLADE_TIP_LIGHT = 0.6;
const BLADE_VALUE_SPREAD: readonly [number, number] = [0.82, 1.14];
const BLADE_HUE_SPREAD = 0.04;
const BLADE_SHEEN = 0.25;
/**
 * The blades write no depth: the screen-space ambient occlusion then reads the smooth ground under
 * them, not a thicket of one-pixel blades that it speckled dark. Drawn after the other opaque
 * objects, they are still hidden by whatever stands in front and still hide the feet of men and
 * walls behind them; among themselves, the carpet's buffer order keeps them back to front.
 */
const GRASS_RENDER_ORDER = 1;

const GRASS_PARS = /* glsl */ `
attribute vec3 aBlade;
attribute float aRing;
uniform sampler2D uGrassHeights;
uniform vec2 uGrassHeightsSize;
uniform sampler2D uGrassSplat;
uniform vec2 uGrassMapSize;
uniform vec2 uGrassOrigin;
// The carpet turned and mirrored (a symmetry of its square lattice, as a mat2's two columns).
uniform vec4 uGrassAxes;
uniform float uGrassSpacing;
uniform float uGrassHeightRef;
${MEADOW_TONE_PARS}
float grassHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

const GRASS_BODY = /* glsl */ `
{
  // Ring k: spacing × 2^k on the same world lattice (the carpet's origin is snapped to the coarsest).
  float spacing = uGrassSpacing * aRing;
  vec2 cell = floor((uGrassOrigin + mat2(uGrassAxes.xy, uGrassAxes.zw) * aBlade.xz) / spacing + 0.5);
  vec2 key = cell + aRing * 173.0;
  float h1 = grassHash(key);
  float h2 = grassHash(key + 17.31);
  float h3 = grassHash(key + 41.07);
  vec2 world = cell * spacing + (vec2(h1, h2) - 0.5) * spacing * 0.95;
  vec4 splat = texture2D(uGrassSplat, world / uGrassMapSize);
  // Path verges keep short tufts (ragged edge, tufts in the middle); fields, mud and water none.
  float allowed = min(1.0 - smoothstep(0.35, 0.55, splat.r), 1.0 - smoothstep(0.12, 0.38, splat.g + splat.b)) * (1.0 - 0.75 * splat.a);
  float verge = mix(1.0, 0.6, smoothstep(0.1, 0.4, splat.r));
  // The meadow runs on 25 m past the map edge, fading, so the seam never reads.
  vec2 beyond = max(max(vec2(0.5) - world, world - (uGrassMapSize - 0.5)), 0.0);
  allowed *= 1.0 - smoothstep(20.0, 45.0, length(beyond));
  vec2 heightsUv = (world + 0.5) / uGrassHeightsSize;
  vec2 heightsStep = 1.0 / uGrassHeightsSize;
  float ground = texture2D(uGrassHeights, heightsUv).r;
  // The ground's normal under the blade (heights on the 1 m grid, central differences).
  vec3 groundN = normalize(vec3(
    texture2D(uGrassHeights, heightsUv - vec2(heightsStep.x, 0.0)).r - texture2D(uGrassHeights, heightsUv + vec2(heightsStep.x, 0.0)).r,
    2.0,
    texture2D(uGrassHeights, heightsUv - vec2(0.0, heightsStep.y)).r - texture2D(uGrassHeights, heightsUv + vec2(0.0, heightsStep.y)).r));
  float camD = distance(vec3(world.x, ground, world.y), cameraPosition);
  // Blades fade with their distance from the camera (not from its focus): no edge on screen.
  float fade = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, camD);
  float clump = smoothstep(0.25, 0.75, paintedValueNoise(world * 0.35));
  float scale = fade * allowed * mix(0.55, 1.0, clump);
  // Flowering blades grow in patches: shorter, wider, butter or mauve heads read as dots.
  float flower = step(0.93, grassHash(key + 73.7)) * step(0.5, smoothstep(0.5, 0.7, paintedFbm(world / 9.0 + 3.0)));
  float ringGrow = 1.0 + 0.15 * log2(aRing);
  float height = mix(0.2, 0.45, h3) * mix(0.6, 1.4, clump) * scale * mix(1.0, 0.6, flower) * verge * ringGrow;
  // Close up the blades thin and shorten (brush strokes, not paper teeth); far away they never get
  // thinner than ~1 px; the sparser outer rings have wider blades, so the meadow keeps its cover.
  float width = (camD < 16.0 ? mix(0.06, 0.0975, smoothstep(8.0, 16.0, camD)) : max(0.0975, 0.0011 * camD)) * scale * mix(1.0, 1.5, flower) * aRing;
  height *= mix(0.7, 1.0, smoothstep(6.0, 16.0, camD));
  float angle = h1 * 6.2831853;
  vec2 side = vec2(cos(angle), sin(angle)) * width;
  // The swell rolling downwind (as over the crops), and each blade's own flutter.
  float swell = paintedWindSwell(world);
  float gust = swell * 0.5 + 0.5 + 0.35 * sin(uTime * 3.1 + h1 * 6.2831853);
  // Constant lean downwind (blades read as oriented brush strokes) + gusts + jitter.
  vec2 lean = (vec2(h2, h1) - 0.5) * 0.45 * height + uWindDir * (0.25 + uWindStrength * gust * 0.35) * height;
  vec3 p;
  float t;
  if (aBlade.y < 0.5) {
    p = vec3(world.x - side.x, ground - 0.02, world.y - side.y);
    t = 0.0;
  } else if (aBlade.y < 1.5) {
    p = vec3(world.x + side.x, ground - 0.02, world.y + side.y);
    t = 0.0;
  } else if (aBlade.y < 3.5) {
    // A curved blade's middle: narrower, leaning less than the tip (the stem bends).
    float s = aBlade.y < 2.5 ? -1.0 : 1.0;
    p = vec3(world.x + s * side.x * 0.62 + lean.x * 0.3, ground + height * 0.55, world.y + s * side.y * 0.62 + lean.y * 0.3);
    t = 0.55;
  } else {
    p = vec3(world.x + lean.x, ground + height, world.y + lean.y);
    t = 1.0;
  }
  transformed = p;
  // Lit as the ground it grows on, on both faces (keepNormalOnBackFaces); shadowed as it is too.
  transformedNormal = normalMatrix * groundN;
  vNormal = normalize(transformedNormal);
  // The ground's own tone under the blade, the terrain's formula: the root in its shade, the tip
  // towards the light. Far off, the blade takes that tone exactly: no specks, no edge.
  float nLarge = paintedFbm(world / 26.0);
  float dry = meadowDryness(groundN, nLarge, ground - uGrassHeightRef);
  float nMid = paintedFbm(world / 7.0 + 7.3);
  vec3 groundTone = meadowTone(meadowLush(nMid), meadowDry(nMid), dry, world, paintedValueNoise(world * 1.9));
  vec3 c = mix(groundTone * ${BLADE_ROOT_SHADE.toFixed(2)}, mix(groundTone, meadowLit(dry), ${BLADE_TIP_LIGHT.toFixed(2)}), t);
  c *= mix(${BLADE_VALUE_SPREAD[0].toFixed(2)}, ${BLADE_VALUE_SPREAD[1].toFixed(2)}, h2) * (1.0 + ${BLADE_SHEEN.toFixed(2)} * uWindStrength * max(swell, 0.0) * t);
  c = max(paintedHueShift(c, (h3 - 0.5) * ${BLADE_HUE_SPREAD.toFixed(2)}), 0.0);
  if (t > 0.99 && flower > 0.5) c = h3 > 0.5 ? vec3(0.81, 0.64, 0.19) : vec3(0.46, 0.37, 0.55);
  c = landscapeHueDrift(mix(c, groundTone, smoothstep(uGrassFade.x * 0.5, uGrassFade.y, camD)), nLarge);
  #ifdef USE_COLOR
  vColor = vec4(c, 1.0);
  #endif
}
`;

/**
 * The carpet: ring 0 is a square of half-size `radiusM` at `spacingM`; ring k covers the square of
 * half-size radiusM·2^k at spacing·2^k, outside ring k−1. Positions are offsets from the carpet's
 * origin on a lattice symmetric about it, so the shader may turn and mirror the carpet; it places
 * each blade. The buffer runs from the outermost ring in, row by row: drawn in this order, with the
 * carpet turned so its first rows are the farthest, the blades overlap back to front.
 */
function bladeGeometry(radiusM: number, spacingM: number, rings: number, curved: boolean): BufferGeometry {
  const verts = curved ? CURVED_VERTS : STRAIGHT_VERTS;
  const offsets: number[] = [];
  const ringOf: number[] = [];
  // Lattice points on each side of the origin, the same in every ring (its spacing and size both double).
  const half = Math.ceil(radiusM / spacingM);
  for (let k = rings - 1; k >= 0; k--) {
    const scale = 2 ** k;
    const spacing = spacingM * scale;
    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) {
        // Ring k−1 covers the points within half of this ring's half-size.
        if (k > 0 && 2 * Math.abs(i) <= half && 2 * Math.abs(j) <= half) continue;
        offsets.push(i * spacing, j * spacing);
        ringOf.push(scale);
      }
    }
  }
  const count = ringOf.length;
  const blade = new Float32Array(count * verts * 3);
  const ring = new Float32Array(count * verts);
  for (let b = 0; b < count; b++) {
    for (let v = 0; v < verts; v++) {
      // Vertex kinds: 0, 1 the base corners; 2, 3 the middle (curved); the last, the tip.
      const kind = curved ? v : v === 2 ? 4 : v;
      const at = (b * verts + v) * 3;
      blade[at] = offsets[b * 2] as number;
      blade[at + 1] = kind;
      blade[at + 2] = offsets[b * 2 + 1] as number;
      ring[b * verts + v] = ringOf[b] as number;
    }
  }
  const g = new BufferGeometry();
  // three requires `position` and `normal` (without a normal it shades flat); the vertex shader
  // replaces both and writes the blade's colour: one shared buffer of zeros for the two, no `color`
  // (34 MB of constants saved at the high preset).
  const placeholder = new BufferAttribute(new Float32Array(count * verts * 3), 3);
  g.setAttribute('position', placeholder);
  g.setAttribute('normal', placeholder);
  g.setAttribute('aBlade', new BufferAttribute(blade, 3));
  g.setAttribute('aRing', new BufferAttribute(ring, 1));
  if (curved) {
    const index = new Uint32Array(count * CURVED_INDICES.length);
    for (let b = 0; b < count; b++) CURVED_INDICES.forEach((v, k) => (index[b * CURVED_INDICES.length + k] = b * verts + v));
    g.setIndex(new BufferAttribute(index, 1));
  }
  return g;
}

export function Grass({
  terrain,
  heights,
  splat,
  preset,
  season,
}: {
  readonly terrain: TerrainData;
  readonly heights: Texture;
  readonly splat: Texture;
  readonly preset: QualityPreset;
  readonly season: SeasonPalette;
}) {
  const spacing = 1 / Math.sqrt(preset.grassDensityPerM2);
  const built = useMemo(() => {
    const origin = new Vector2();
    const axes = new Vector4(1, 0, 0, 1);
    let heightSum = 0;
    for (const h of terrain.heights) heightSum += h;
    paintedGlobals.uGrassFade.value.set(preset.grassFadeM * FULL_SHARE, preset.grassFadeM);
    const material = createPaintedMaterial({
      name: 'Grass',
      ground: true,
      vertexColors: true,
      side: DoubleSide,
      keepNormalOnBackFaces: true,
      wrap: MEADOW_WRAP,
      heightM: 1,
      gradientBase: 1,
      gradientTop: 1,
      gradientSaturation: 0,
      // The ground's tone, grain and hue drift are already in the blade's colour.
      hueNoiseAmp: 0,
      valueNoiseAmp: 0,
      groundAO: 0,
      customVertex: {
        key: preset.grassCurved ? 'grass-v3-curved' : 'grass-v3',
        pars: GRASS_PARS,
        body: GRASS_BODY,
        uniforms: {
          uGrassHeights: { value: heights },
          uGrassHeightsSize: { value: new Vector2(terrain.width + 1, terrain.depth + 1) },
          uGrassSplat: { value: splat },
          uGrassMapSize: { value: new Vector2(terrain.width * terrain.cellSize, terrain.depth * terrain.cellSize) },
          uGrassOrigin: { value: origin },
          uGrassAxes: { value: axes },
          uGrassHeightRef: { value: heightSum / terrain.heights.length },
          uGrassSpacing: { value: spacing },
          ...meadowUniforms(season),
        },
      },
    });
    material.depthWrite = false;
    const mesh = new Mesh(bladeGeometry(preset.grassRadiusM, spacing, preset.grassRings, preset.grassCurved), material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = GRASS_RENDER_ORDER;
    mesh.name = 'Grass';
    // The whole carpet for a mirror that would show its fringe on the banks at most.
    keepOutOfReflections(mesh);
    // The carpet's origin snaps to its coarsest ring's spacing: every ring stays on its world lattice.
    return { mesh, origin, axes, snap: spacing * 2 ** (preset.grassRings - 1) };
  }, [terrain, heights, splat, preset, spacing, season]);

  useEffect(
    () => () => {
      built.mesh.geometry.dispose();
      (built.mesh.material as { dispose(): void }).dispose();
    },
    [built],
  );

  useFrame(({ camera }) => {
    const focus = paintedGlobals.uFocus.value;
    // A high, wide view: every blade would be past its fade distance.
    built.mesh.visible = camera.position.y - focus.y < preset.grassFadeM;
    const x = camera.position.x + (focus.x - camera.position.x) * CARPET_TOWARDS_FOCUS;
    const z = camera.position.z + (focus.z - camera.position.z) * CARPET_TOWARDS_FOCUS;
    built.origin.set(Math.round(x / built.snap) * built.snap, Math.round(z / built.snap) * built.snap);
    // Rows across the main direction of the view, the first ones (and the start of each row) on the
    // far side: the buffer is drawn back to front.
    const dx = focus.x - camera.position.x;
    const dz = focus.z - camera.position.z;
    const sx = dx >= 0 ? -1 : 1;
    const sz = dz >= 0 ? -1 : 1;
    if (Math.abs(dz) >= Math.abs(dx)) built.axes.set(sx, 0, 0, sz);
    else built.axes.set(0, sz, sx, 0);
  });

  return <primitive object={built.mesh} />;
}
