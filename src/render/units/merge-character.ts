/**
 * One draw call per unit: a KayKit body (skinned parts + rigid parts parented to bones) and its
 * weapons are merged into a single SkinnedMesh geometry, then re-bound to a fresh Skeleton.
 *
 * Re-binding avoids any dependence on the source inverse-bind matrices (KayKit's carry a scale
 * and an offset, and every skinned part has its own skin): at rest pose every vertex is brought
 * to world space (skinned parts through their own bone transforms, rigid parts through their
 * world matrix), and the new skeleton's inverses are computed from the same rest pose. The
 * original bones keep driving the animation.
 *
 * The palette-atlas texture is baked into vertex colours (already faction-recoloured), so every
 * unit shares one material and one shader program.
 */
import { Bone, BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, Skeleton, SkinnedMesh, Vector3, type Object3D, type Texture } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Faction } from '../../core/rules/types.ts';
import { recolorPixels, type HueRange } from './team-colors.ts';

export interface WeaponMount {
  readonly bone: string;
  readonly scene: Object3D;
  readonly clothHues: readonly HueRange[];
}

interface Sampler {
  sample(u: number, v: number, out: [number, number, number]): void;
}

const BYTE = 255;
/** Pull of each colour sample towards its triangle's UV centroid (stays inside the swatch). */
const UV_INSET = 0.3;
const samplerCache = new WeakMap<Texture, Map<string, Sampler>>();

/** CPU sampler of a (recoloured) texture, nearest filtering, sRGB → linear. */
function samplerFor(texture: Texture, clothHues: readonly HueRange[], faction: Faction): Sampler {
  const key = `${faction}:${JSON.stringify(clothHues)}`;
  let perTexture = samplerCache.get(texture);
  if (!perTexture) {
    perTexture = new Map();
    samplerCache.set(texture, perTexture);
  }
  const cached = perTexture.get(key);
  if (cached) return cached;
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolorPixels(pixels.data, clothHues, faction);
  const lut = new Float32Array(256).map((_, i) => {
    const s = i / BYTE;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const flipY = texture.flipY;
  const sampler: Sampler = {
    sample(u, v, out) {
      const x = Math.min(canvas.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * canvas.width)));
      const vv = v - Math.floor(v);
      const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((flipY ? 1 - vv : vv) * canvas.height)));
      const i = (y * canvas.width + x) * 4;
      out[0] = lut[pixels.data[i] as number] as number;
      out[1] = lut[pixels.data[i + 1] as number] as number;
      out[2] = lut[pixels.data[i + 2] as number] as number;
    },
  };
  perTexture.set(key, sampler);
  return sampler;
}

interface PartSource {
  readonly mesh: Mesh;
  readonly clothHues: readonly HueRange[];
  /** Rigid pieces: the bone they follow (index in the merged skeleton). */
  readonly rigidBone: number | null;
}

/** World-space (rest pose) geometry with baked colour and skinning attributes. */
function bakePart(part: PartSource, bones: readonly Bone[], faction: Faction): BufferGeometry {
  const { mesh } = part;
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const count = src.getAttribute('position').count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const pos = src.getAttribute('position');
  const nor = src.getAttribute('normal');
  const uv = src.getAttribute('uv');
  const srcIndex = src.getAttribute('skinIndex');
  const srcWeight = src.getAttribute('skinWeight');
  const material = mesh.material as { map?: Texture | null; color?: { r: number; g: number; b: number } };
  const sampler = material.map ? samplerFor(material.map, part.clothHues, faction) : null;
  const skinned = mesh instanceof SkinnedMesh && srcIndex && srcWeight ? mesh : null;
  const remap = skinned ? skinned.skeleton.bones.map((b) => Math.max(0, bones.indexOf(b))) : null;

  const rgb: [number, number, number] = [1, 1, 1];
  const p = new Vector3();
  const n = new Vector3();
  const blend = new Matrix4();
  const tmp = new Matrix4();
  const normalMatrix = new Matrix3();
  const rigidWorld = mesh.matrixWorld;
  const rigidNormal = new Matrix3().getNormalMatrix(rigidWorld);

  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i);
    if (nor) n.fromBufferAttribute(nor, i);
    else n.set(0, 1, 0);
    if (skinned && remap && srcIndex && srcWeight) {
      // Rest-pose skinning, exactly as three does it: S · B⁻¹ · Σ wᵢ (boneWorldᵢ · boneInverseᵢ) · B.
      blend.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      const sk = skinned.skeleton;
      for (let k = 0; k < 4; k++) {
        const w = k === 0 ? srcWeight.getX(i) : k === 1 ? srcWeight.getY(i) : k === 2 ? srcWeight.getZ(i) : srcWeight.getW(i);
        if (w === 0) continue;
        const j = k === 0 ? srcIndex.getX(i) : k === 1 ? srcIndex.getY(i) : k === 2 ? srcIndex.getZ(i) : srcIndex.getW(i);
        const bone = sk.bones[j];
        const inverse = sk.boneInverses[j];
        if (!bone || !inverse) continue;
        tmp.multiplyMatrices(bone.matrixWorld, inverse);
        const e = tmp.elements;
        const b = blend.elements;
        for (let m = 0; m < 16; m++) b[m] = (b[m] as number) + (e[m] as number) * w;
        skinIndex[i * 4 + k] = remap[j] ?? 0;
        skinWeight[i * 4 + k] = w;
      }
      tmp.copy(skinned.matrixWorld).multiply(skinned.bindMatrixInverse).multiply(blend).multiply(skinned.bindMatrix);
      p.applyMatrix4(tmp);
      normalMatrix.getNormalMatrix(tmp);
      n.applyMatrix3(normalMatrix).normalize();
    } else {
      p.applyMatrix4(rigidWorld);
      n.applyMatrix3(rigidNormal).normalize();
      skinIndex[i * 4] = part.rigidBone ?? 0;
      skinWeight[i * 4] = 1;
    }
    position.set([p.x, p.y, p.z], i * 3);
    normal.set([n.x, n.y, n.z], i * 3);
    if (sampler && uv) {
      // Palette atlases: a vertex sits on swatch borders; sample slightly inside its triangle.
      const t0 = i - (i % 3);
      const cu = (uv.getX(t0) + uv.getX(t0 + 1) + uv.getX(t0 + 2)) / 3;
      const cv = (uv.getY(t0) + uv.getY(t0 + 1) + uv.getY(t0 + 2)) / 3;
      sampler.sample(uv.getX(i) + (cu - uv.getX(i)) * UV_INSET, uv.getY(i) + (cv - uv.getY(i)) * UV_INSET, rgb);
    } else if (material.color) {
      rgb[0] = material.color.r;
      rgb[1] = material.color.g;
      rgb[2] = material.color.b;
    }
    color.set(rgb, i * 3);
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(position, 3));
  out.setAttribute('normal', new BufferAttribute(normal, 3));
  out.setAttribute('color', new BufferAttribute(color, 3));
  out.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  out.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  if (src !== mesh.geometry) src.dispose();
  return out;
}

/** Props every KayKit body ships with (all variants at once); the loadout attaches its own. */
const BUILT_IN_PROPS = /(shield|sword|axe|crossbow|dagger|knife|staff|wand|spellbook|book|mug|arrow|quiver|smokebomb)/i;

function isBuiltInProp(mesh: Mesh): boolean {
  for (let o: Object3D | null = mesh; o && !(o instanceof Bone); o = o.parent) {
    if (BUILT_IN_PROPS.test(o.name)) return true;
  }
  return false;
}

function parentBone(obj: Object3D, bones: readonly Bone[]): number {
  for (let o: Object3D | null = obj.parent; o; o = o.parent) {
    if (o instanceof Bone) {
      const i = bones.indexOf(o);
      if (i >= 0) return i;
    }
  }
  return 0;
}

/**
 * Merges a cloned body (and weapons) into one SkinnedMesh bound to a fresh skeleton made of the
 * body's own bones. `body` must be a SkeletonUtils clone at rest pose, with an identity root.
 */
export function mergeCharacter(body: Object3D, weapons: readonly WeaponMount[], clothHues: readonly HueRange[], faction: Faction): SkinnedMesh {
  body.updateMatrixWorld(true);
  const bones: Bone[] = [];
  body.traverse((o) => {
    if (o instanceof Bone) bones.push(o);
  });
  const sources: PartSource[] = [];
  const meshes: Mesh[] = [];
  body.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o);
  });
  for (const mesh of meshes) {
    if (!(mesh instanceof SkinnedMesh) && isBuiltInProp(mesh)) continue;
    sources.push({ mesh, clothHues, rigidBone: mesh instanceof SkinnedMesh ? null : parentBone(mesh, bones) });
  }

  const attached: Object3D[] = [];
  for (const mount of weapons) {
    const bone = body.getObjectByName(mount.bone);
    if (!(bone instanceof Bone)) continue;
    const weapon = mount.scene.clone(true);
    bone.add(weapon);
    weapon.updateMatrixWorld(true);
    attached.push(weapon);
    weapon.traverse((o) => {
      if (o instanceof Mesh) sources.push({ mesh: o, clothHues: mount.clothHues, rigidBone: Math.max(0, bones.indexOf(bone)) });
    });
  }

  const parts = sources.map((s) => bakePart(s, bones, faction));
  for (const w of attached) w.removeFromParent();
  for (const mesh of meshes) mesh.removeFromParent();

  const geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!geometry) throw new Error('mergeCharacter: merge failed');
  geometry.computeBoundingSphere();

  const merged = new SkinnedMesh(geometry);
  merged.name = 'UnitBody';
  body.add(merged);
  merged.updateMatrixWorld(true);
  // Fresh inverses from the very rest pose the vertices were baked in.
  merged.bind(new Skeleton(bones), merged.matrixWorld.clone());
  return merged;
}
